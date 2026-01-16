from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Union

import joblib
import numpy as np
import pandas as pd



TORONTO_TZ = "America/Toronto"

LAGS_MIN = [1, 5, 15, 60]
ROLL_WINS_MIN = [5, 15, 60]


@dataclass
class ModelBundle:
    target: str
    feature_cols: List[str]
    model: object
    hmax_min: int
    cadence_min: int

import sys
import __main__ as _main

try:
    if not hasattr(_main, "ModelBundle"):
        setattr(_main, "ModelBundle", ModelBundle)
except Exception:
    pass


# --------- time / feature helpers ---------

def _ensure_datetime_utc(df: pd.DataFrame) -> pd.DataFrame:
    if "ts_utc" not in df.columns:
        raise ValueError("Expected a 'ts_utc' column in the history dataframe.")
    out = df.copy()
    out["ts_utc"] = pd.to_datetime(out["ts_utc"], utc=True, errors="coerce")
    if out["ts_utc"].isna().any():
        bad = out[out["ts_utc"].isna()].head(5)
        raise ValueError(f"Invalid ts_utc values found. Examples:\n{bad}")
    return out


def _parse_future_time(future_time: Union[str, pd.Timestamp]) -> pd.Timestamp:
    ts = pd.to_datetime(future_time, errors="raise")

    # Robust tz-awareness check: use .tz (pandas) not .tzinfo (python)
    if getattr(ts, "tz", None) is None:
        ts = ts.tz_localize(TORONTO_TZ)

    return ts.tz_convert("UTC")


def _add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    ts_local = out["ts_utc"].dt.tz_convert(TORONTO_TZ)

    out["hour"] = ts_local.dt.hour
    out["minute"] = ts_local.dt.minute
    out["dow"] = ts_local.dt.dayofweek
    out["is_weekend"] = (out["dow"] >= 5).astype(int)

    out["hour_sin"] = np.sin(2 * np.pi * out["hour"] / 24.0)
    out["hour_cos"] = np.cos(2 * np.pi * out["hour"] / 24.0)
    out["min_sin"] = np.sin(2 * np.pi * out["minute"] / 60.0)
    out["min_cos"] = np.cos(2 * np.pi * out["minute"] / 60.0)
    return out


def _make_lag_roll_features(df: pd.DataFrame, target: str, cadence_min: int) -> pd.DataFrame:
    out = df.copy().sort_values(["sensor_id", "ts_utc"])
    g = out.groupby("sensor_id", group_keys=False)[target]

    for lag_min in LAGS_MIN:
        steps = int(lag_min / cadence_min)
        out[f"{target}_lag_{lag_min}m"] = g.shift(steps)

    shifted = g.shift(1)
    for win_min in ROLL_WINS_MIN:
        steps = int(win_min / cadence_min)
        out[f"{target}_roll_mean_{win_min}m"] = shifted.rolling(steps).mean()
        out[f"{target}_roll_std_{win_min}m"] = shifted.rolling(steps).std()

    return out


# --------- model bundle loading (cached) ---------

_BUNDLE_CACHE: dict[str, ModelBundle] = {}


def _load_bundle(path: str) -> ModelBundle:
    b = joblib.load(path)
    for attr in ["target", "feature_cols", "model", "hmax_min", "cadence_min"]:
        if not hasattr(b, attr):
            raise ValueError(f"Bundle at '{path}' missing '{attr}'. Retrain or fix bundle.")
    return ModelBundle(
        target=getattr(b, "target"),
        feature_cols=list(getattr(b, "feature_cols")),
        model=getattr(b, "model"),
        hmax_min=int(getattr(b, "hmax_min")),
        cadence_min=int(getattr(b, "cadence_min")),
    )


def load_bundle_cached(models_dir: str, metric: str) -> ModelBundle:
    """
    metric: "average_db" or "celsius"
    expects files:
      models/average_db_bundle.joblib
      models/celsius_bundle.joblib
    """
    filename = f"{metric}_bundle.joblib"
    path = os.path.join(models_dir, filename)

    if path in _BUNDLE_CACHE:
        return _BUNDLE_CACHE[path]

    if not os.path.exists(path):
        raise ValueError(f"Missing model bundle: {path}")

    bundle = _load_bundle(path)
    _BUNDLE_CACHE[path] = bundle
    return bundle


# --------- prediction core ---------

def predict_at_time(bundle: ModelBundle, history_df: pd.DataFrame, sensor_id: int, future_time: Union[str, pd.Timestamp]) -> float:
    df = _ensure_datetime_utc(history_df)

    if "sensor_id" not in df.columns:
        raise ValueError("Expected 'sensor_id' column in the history dataframe.")
    if bundle.target not in df.columns:
        raise ValueError(f"History is missing required column '{bundle.target}'.")

    df = df[df["sensor_id"] == sensor_id].copy()
    if df.empty:
        raise ValueError(f"No rows found for sensor_id={sensor_id}")

    df[bundle.target] = pd.to_numeric(df[bundle.target], errors="coerce")
    df = df.sort_values("ts_utc")

    now_utc = df["ts_utc"].iloc[-1]
    fut_utc = _parse_future_time(future_time)

    horizon_min = int(round((fut_utc - now_utc).total_seconds() / 60.0))
    if horizon_min < 1:
        raise ValueError(f"future_time must be after last data point. last={now_utc} future={fut_utc}")
    if horizon_min > bundle.hmax_min:
        raise ValueError(f"horizon {horizon_min}m exceeds trained hmax {bundle.hmax_min}m. Retrain with larger hmax.")

    df = _add_time_features(df)
    df = _make_lag_roll_features(df, bundle.target, bundle.cadence_min)

    last = df.iloc[-1:].copy()
    last["horizon_min"] = horizon_min

    X = last[bundle.feature_cols].copy()
    if X.isna().any(axis=None):
        missing = X.columns[X.isna().any()].tolist()
        raise ValueError(
            "Not enough history to compute features. "
            f"Missing: {missing}. "
            "Provide >=60 minutes of recent history for this sensor."
        )

    return float(bundle.model.predict(X)[0])


# --------- supabase integration ---------

def fetch_history_from_supabase(
    supabase_client,
    table_name: str,
    sensor_id: int,
    lookback_hours: int = 72,
    limit: int = 50000,
) -> pd.DataFrame:
    """
    Returns a DataFrame with at least: sensor_id, ts_utc, average_db, celsius
    """
    now_utc = pd.Timestamp.now(tz="UTC")
    start_utc = now_utc - pd.Timedelta(hours=lookback_hours)

    res = (
        supabase_client.table(table_name)
        .select("sensor_id,ts_utc,average_db,celsius")
        .eq("sensor_id", sensor_id)
        .gte("ts_utc", start_utc.isoformat())
        .lte("ts_utc", now_utc.isoformat())
        .order("ts_utc", desc=False)
        .limit(limit)
        .execute()
    )

    data = getattr(res, "data", None)
    if data is None:
        raise RuntimeError("Supabase query failed (res.data is None).")

    df = pd.DataFrame(data)
    if df.empty:
        return df

    # Ensure required columns exist (even if missing in data)
    for col in ["sensor_id", "ts_utc", "average_db", "celsius"]:
        if col not in df.columns:
            df[col] = None

    return df


def predict_from_supabase(
    supabase_client,
    table_name: str,
    sensor_id: int,
    metric: str,  # "average_db" or "celsius"
    future_ts_utc,  # datetime from FastAPI / Pydantic
    models_dir: str = "models",
    lookback_hours: int = 72,
) -> dict:
    """
    Returns a dict shaped like your SensorPredictResponse.
    """
    if metric not in ("average_db", "celsius"):
        raise ValueError("metric must be 'average_db' or 'celsius'")

    hist = fetch_history_from_supabase(
        supabase_client=supabase_client,
        table_name=table_name,
        sensor_id=sensor_id,
        lookback_hours=lookback_hours,
    )
    if hist.empty:
        raise ValueError(f"No recent history found for sensor_id={sensor_id} (lookback={lookback_hours}h).")

    bundle = load_bundle_cached(models_dir=models_dir, metric=metric)

    # Future time: accept datetime or string; convert to pandas Timestamp
    future_str = future_ts_utc.isoformat() if hasattr(future_ts_utc, "isoformat") else str(future_ts_utc)

    pred = predict_at_time(bundle=bundle, history_df=hist, sensor_id=sensor_id, future_time=future_str)

    unit = "°C" if metric == "celsius" else "dBA"
    model_name = os.path.basename(os.path.join(models_dir, f"{metric}_bundle.joblib"))

    return {
        "sensor_id": int(sensor_id),
        "metric": metric,
        "future_ts_utc": future_str,
        "prediction": float(pred),
        "unit": unit,
        "model": model_name,
        "note": f"Predicted using last {lookback_hours}h history from Supabase + trained bundle.",
    }
