import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client, create_client

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple, Literal
from zoneinfo import ZoneInfo
from fastapi import Query, HTTPException

from pydantic import BaseModel

from predictor import predict_from_supabase

from dotenv import load_dotenv
load_dotenv() 


TORONTO_TZ = ZoneInfo("America/Toronto")

HEAT_HIGH_C = 31.0   # aligns to Ontario heat-warning daytime criterion
HEAT_ELEVATED_C = 26.0  # temp-only proxy

NOISE_DAY_START_H = 7   
NOISE_NIGHT_START_H = 21
NOISE_DAY_VIOLATION_DB = 65.0
NOISE_NIGHT_VIOLATION_DB = 55.0  # more protective at night


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

TABLE_NAME = "sensor_data_backup"

SENSOR_META = {
    1: {
        "name": "Quiet residential",
        "area_type": "residential",
        "placement": "backyard / side-street",
        "notes": "Generally quiet; spikes likely indicate short events (vehicles, groups).",
        "expected_noise_db_range": [40, 60],
        "expected_temp_bias_c": 0.0,
    },
    2: {
        "name": "Residential near main road",
        "area_type": "mixed residential",
        "placement": "near arterial road",
        "notes": "Slightly louder baseline; commute peaks expected.",
        "expected_noise_db_range": [45, 70],
        "expected_temp_bias_c": 0.0,
    },
    3: {
        "name": "Nightlife / clubs",
        "area_type": "entertainment",
        "placement": "near clubs / high foot traffic",
        "notes": "Late-night peaks expected; sustained elevated dB likely normal in context.",
        "expected_noise_db_range": [55, 85],
        "expected_temp_bias_c": 0.0,
    },
    4: {
        "name": "Construction-adjacent",
        "area_type": "construction",
        "placement": "near active construction site",
        "notes": "Weekday daytime spikes; verify permits/hours if sustained.",
        "expected_noise_db_range": [50, 90],
        "expected_temp_bias_c": 0.0,
    },
}


class SensorAnalysisRequest(BaseModel):
    message: str
    sensor_id: int | None = None
    start: datetime | None = None
    end: datetime | None = None

class SensorAnalysisResponse(BaseModel):
    reply: str

class SensorPredictRequest(BaseModel):
    sensor_id: int
    metric: Literal["celsius", "average_db"]
    future_ts_utc: datetime

class SensorPredictResponse(BaseModel):
    sensor_id: int
    metric: str
    future_ts_utc: str
    prediction: float
    unit: str
    model: str
    note: str


supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
    allow_headers=["*"],
)


def _parse_ts(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    s = ts.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None

    # If tz is missing, treat it as UTC (your column is ts_utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    # Normalize to UTC
    return dt.astimezone(timezone.utc)

def _mean(vals: List[float]) -> Optional[float]:
    if not vals:
        return None
    return sum(vals) / len(vals)

def _trend_label(curr_mean: Optional[float], prev_mean: Optional[float], eps: float = 0.15) -> str:
    if curr_mean is None or prev_mean is None:
        return "Unknown"
    delta = curr_mean - prev_mean
    if abs(delta) <= eps:
        return "Stable"
    return "Worsening" if delta > 0 else "Improving"

def _bucket_series(rows: List[dict], key: str, hours: int = 24) -> List[dict]:
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(TORONTO_TZ)
    start_local = now_local - timedelta(hours=hours)

    buckets: Dict[datetime, List[float]] = {}

    for r in rows:
        ts_utc = _parse_ts(r.get("ts_utc"))
        if ts_utc is None:
            continue

        ts_local = ts_utc.astimezone(TORONTO_TZ)

        if ts_local < start_local or ts_local > now_local:
            continue

        v = r.get(key)
        if v is None:
            continue

        hour_local = ts_local.replace(minute=0, second=0, microsecond=0)
        buckets.setdefault(hour_local, []).append(float(v))

    out = []
    for hour_local in sorted(buckets.keys()):
        out.append({
            # epoch ms for that local-hour boundary instant
            "t": int(hour_local.timestamp() * 1000),
            "value": _mean(buckets[hour_local]),
        })

    return out

def _window_means(rows: List[dict], key: str, now: datetime) -> Dict[str, Tuple[Optional[float], Optional[float]]]:
    def mean_in(start: datetime, end: datetime) -> Optional[float]:
        vals: List[float] = []
        for r in rows:
            ts = _parse_ts(r.get("ts_utc"))
            if ts is None:
                continue
            if start <= ts <= end:
                v = r.get(key)
                if v is not None:
                    vals.append(float(v))
        return _mean(vals)

    last6_start = now - timedelta(hours=6)
    prev6_start = now - timedelta(hours=12)
    prev6_end = now - timedelta(hours=6)

    last24_start = now - timedelta(hours=24)
    prev24_start = now - timedelta(hours=48)
    prev24_end = now - timedelta(hours=24)

    return {
        "6h": (mean_in(last6_start, now), mean_in(prev6_start, prev6_end)),
        "24h": (mean_in(last24_start, now), mean_in(prev24_start, prev24_end)),
    }

def _heat_risk_label(temp_c: Optional[float]) -> str:
    if temp_c is None:
        return "Unknown"
    if temp_c >= HEAT_HIGH_C:
        return "High"
    if temp_c >= HEAT_ELEVATED_C:
        return "Elevated"
    return "Normal"

def _noise_violation_threshold(now_local: datetime) -> float:
    h = now_local.hour
    is_night = (h >= NOISE_NIGHT_START_H) or (h < NOISE_DAY_START_H)
    return NOISE_NIGHT_VIOLATION_DB if is_night else NOISE_DAY_VIOLATION_DB

def _fetch_rows_last_hours(hours: int) -> List[dict]:
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)

    res = (
        supabase.table(TABLE_NAME)
        .select("sensor_id,location_name,lat,lon,ts_utc,created_at,average_db,max_db,celsius")
        .gte("ts_utc", start.isoformat())
        .lte("ts_utc", now.isoformat())
        .order("ts_utc", desc=False)
        .limit(50000)
        .execute()
    )
    if res.data is None:
        raise HTTPException(status_code=500, detail="Supabase query failed")
    return res.data

def _latest_per_sensor(rows: List[dict]) -> Dict[int, dict]:
    latest: Dict[int, dict] = {}
    for r in rows:
        sid = int(r["sensor_id"])
        ts = _parse_ts(r.get("ts_utc")) or datetime.min.replace(tzinfo=timezone.utc)
        if sid not in latest:
            latest[sid] = r
            continue
        prev_ts = _parse_ts(latest[sid].get("ts_utc")) or datetime.min.replace(tzinfo=timezone.utc)
        if ts >= prev_ts:
            latest[sid] = r
    return latest

@app.get("/sensor-data/range")
def get_sensor_data_range(
    start: datetime,
    end: datetime,
    sensor_ids: Optional[List[int]] = Query(default=None),  # ?sensor_ids=1&sensor_ids=2
    time_column: str = Query(default="ts_utc", pattern="^(ts_utc|created_at)$"),
) -> Dict[str, Any]:
    if start > end:
        raise HTTPException(status_code=400, detail="start must be <= end")
    
    print("HELOOOOs")
    print(start, end, sensor_ids, time_column)


    q = (
        supabase.table(TABLE_NAME)
        .select("*")
        .gte(time_column, start.isoformat())
        .lte(time_column, end.isoformat())
        .order("sensor_id", desc=False)
        .order(time_column, desc=False)
    )

    if sensor_ids:
        q = q.in_("sensor_id", sensor_ids)

    res = q.execute()
    if res.data is None:
        raise HTTPException(status_code=500, detail="Supabase query failed")
    print(res.data)
    grouped: Dict[str, List[dict]] = {}
    for row in res.data:
        sid = str(row["sensor_id"])
        grouped.setdefault(sid, []).append(row)
    print({
        "start": start.isoformat(),
        "end": end.isoformat(),
        "time_column": time_column,
        "count": len(res.data),
        "by_sensor": grouped,
    })
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "time_column": time_column,
        "count": len(res.data),
        "by_sensor": grouped,
    }


@app.get("/sensor-data/latest")
def get_latest_row_per_sensor() -> Dict[str, Any]:
    time_column = "ts_utc" 

    res = (
        supabase.table(TABLE_NAME)
        .select("*")
        .order(time_column, desc=True)
        .order("created_at", desc=True)
        .limit(5000)  # plenty for 3 sensors
        .execute()
    )
    if res.data is None:
        raise HTTPException(status_code=500, detail="Supabase query failed")

    latest: Dict[int, dict] = {}
    for row in res.data:
        sid = row["sensor_id"]
        if sid not in latest:
            latest[sid] = row

    rows = [latest[k] for k in sorted(latest.keys())]
    return {"count": len(rows), "rows": rows}

@app.get("/sensors")
def list_sensors() -> Dict[str, Any]:
    res = (
        supabase.table(TABLE_NAME)
        .select("sensor_id,location_name,lat,lon,ts_utc")
        .order("ts_utc", desc=True)
        .limit(5000)
        .execute()
    )
    if res.data is None:
        raise HTTPException(status_code=500, detail="Supabase query failed")

    latest: Dict[int, dict] = {}
    for row in res.data:
        sid = row["sensor_id"]
        if sid not in latest:
            latest[sid] = {
                "sensor_id": sid,
                "location_name": row.get("location_name"),
                "lat": row.get("lat"),
                "lon": row.get("lon"),
            }

    rows = [latest[k] for k in sorted(latest.keys())]
    return {"count": len(rows), "rows": rows}

@app.get("/sensor-data/series")
def get_sensor_series(
    sensor_id: int = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    time_column: str = Query(default="ts_utc", pattern="^(ts_utc|created_at)$"),
) -> Dict[str, Any]:
    if start > end:
        raise HTTPException(status_code=400, detail="start must be <= end")

    res = (
        supabase.table(TABLE_NAME)
        .select("ts_utc,created_at,average_db,max_db,celsius,sensor_id,location_name,lat,lon")
        .eq("sensor_id", sensor_id)
        .gte(time_column, start.isoformat())
        .lte(time_column, end.isoformat())
        .order(time_column, desc=False)
        .execute()
    )
    if res.data is None:
        raise HTTPException(status_code=500, detail="Supabase query failed")

    
    print( {
        "sensor_id": sensor_id,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "time_column": time_column,
        "count": len(res.data),
        "rows": res.data,
    })
    return {
        "sensor_id": sensor_id,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "time_column": time_column,
        "count": len(res.data),
        "rows": res.data,
    }

@app.get("/dashboard/temperature")
def dashboard_temperature(top_n: int = Query(default=5, ge=1, le=25)) -> Dict[str, Any]:
    rows = _fetch_rows_last_hours(48)
    latest = _latest_per_sensor(rows)
    now_utc = datetime.now(timezone.utc)

    # build per-sensor trends from rows grouped by sensor
    rows_by_sensor: Dict[int, List[dict]] = {}
    for r in rows:
        rows_by_sensor.setdefault(int(r["sensor_id"]), []).append(r)

    hotspots = []
    for sid, lr in latest.items():
        temp = lr.get("celsius")
        wm = _window_means(rows_by_sensor.get(sid, []), "celsius", now_utc)
        t6 = _trend_label(wm["6h"][0], wm["6h"][1])
        t24 = _trend_label(wm["24h"][0], wm["24h"][1])

        exceed = None
        if temp is not None:
            exceed = max(0.0, float(temp) - HEAT_ELEVATED_C)

        hotspots.append({
            "sensor_id": sid,
            "location_name": lr.get("location_name") or f"Sensor {sid}",
            "lat": lr.get("lat"),
            "lon": lr.get("lon"),
            "current_c": temp,
            "risk_label": _heat_risk_label(float(temp) if temp is not None else None),
            "threshold_exceedance_c": exceed,
            "last_update_utc": lr.get("ts_utc") or lr.get("created_at"),
            "trend_6h": t6,
            "trend_24h": t24,
        })

    hotspots_sorted = sorted(
        hotspots,
        key=lambda x: (x["current_c"] is not None, x["current_c"]),
        reverse=True
    )[:top_n]

    all_temp_rows = [r for r in rows if r.get("celsius") is not None]
    city_wm = _window_means(all_temp_rows, "celsius", now_utc)
    city_trend_6h = _trend_label(city_wm["6h"][0], city_wm["6h"][1])
    city_trend_24h = _trend_label(city_wm["24h"][0], city_wm["24h"][1])

    series_24h = _bucket_series(rows, "celsius", hours=24)

    return {
        "now_utc": now_utc.isoformat(),
        "thresholds": {
            "elevated_c": HEAT_ELEVATED_C,
            "high_c": HEAT_HIGH_C,  # aligned to 31°C heat-warning
            "note": "Temp-only (no humidity/humidex available)."
        },
        "top_hotspots_now": hotspots_sorted,
        "trend": {
            "city_6h": city_trend_6h,
            "city_24h": city_trend_24h,
        },
        "series_24h": series_24h,
    }

@app.get("/dashboard/noise")
def dashboard_noise(top_n: int = Query(default=5, ge=1, le=25)) -> Dict[str, Any]:
    rows = _fetch_rows_last_hours(48)
    latest = _latest_per_sensor(rows)
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(TORONTO_TZ)

    rows_by_sensor: Dict[int, List[dict]] = {}
    for r in rows:
        rows_by_sensor.setdefault(int(r["sensor_id"]), []).append(r)

    current_threshold = _noise_violation_threshold(now_local)

    hotspots = []
    violations = []
    for sid, lr in latest.items():
        db = lr.get("average_db")
        wm = _window_means(rows_by_sensor.get(sid, []), "average_db", now_utc)
        t24 = _trend_label(wm["24h"][0], wm["24h"][1])

        exceed = None
        is_violation = False
        if db is not None:
            exceed = max(0.0, float(db) - current_threshold)
            is_violation = float(db) >= current_threshold

        row_out = {
            "sensor_id": sid,
            "location_name": lr.get("location_name") or f"Sensor {sid}",
            "lat": lr.get("lat"),
            "lon": lr.get("lon"),
            "current_avg_db": db,
            "threshold_db": current_threshold,
            "threshold_exceedance_db": exceed,
            "is_violation_proxy": is_violation,
            "last_update_utc": lr.get("ts_utc") or lr.get("created_at"),
            "trend_24h": t24,
        }
        hotspots.append(row_out)
        if is_violation:
            violations.append(row_out)

    hotspots_sorted = sorted(
        hotspots,
        key=lambda x: (x["current_avg_db"] is not None, x["current_avg_db"]),
        reverse=True
    )[:top_n]

    all_db_rows = [r for r in rows if r.get("average_db") is not None]
    city_wm = _window_means(all_db_rows, "average_db", now_utc)
    city_trend_24h = _trend_label(city_wm["24h"][0], city_wm["24h"][1])

    series_24h = _bucket_series(rows, "average_db", hours=24)

    return {
        "now_utc": now_utc.isoformat(),
        "now_local": now_local.isoformat(),
        "thresholds": {
            "day_db": NOISE_DAY_VIOLATION_DB,
            "night_db": NOISE_NIGHT_VIOLATION_DB,
            "current_db": current_threshold,
            "note": "Threshold based on measured dBA + day/night; Kingston bylaw itself is activity/time-based."
        },
        "top_hotspots_now": hotspots_sorted,
        "noise_violations": violations,
        "trend": {
            "city_24h": city_trend_24h,
        },
        "series_24h": series_24h,
    }

def _heat_risk_series_24h(rows_in: List[dict]) -> List[dict]:
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(TORONTO_TZ)
    start_local = now_local - timedelta(hours=24)

    buckets: Dict[datetime, Dict[int, List[float]]] = {}

    for r in rows_in:
        ts_utc = _parse_ts(r.get("ts_utc"))
        if ts_utc is None:
            continue

        ts_local = ts_utc.astimezone(TORONTO_TZ)

        if ts_local < start_local or ts_local > now_local:
            continue

        v = r.get("celsius")
        if v is None:
            continue

        hour_local = ts_local.replace(minute=0, second=0, microsecond=0)
        sid = int(r["sensor_id"])
        buckets.setdefault(hour_local, {}).setdefault(sid, []).append(float(v))

    start_hour = start_local.replace(minute=0, second=0, microsecond=0)
    end_hour = now_local.replace(minute=0, second=0, microsecond=0)

    out: List[dict] = []
    h = start_hour
    while h <= end_hour:
        elevated = 0
        high = 0
        total = 0

        per_sensor = buckets.get(h, {})
        for _, vals in per_sensor.items():
            m = _mean(vals)
            if m is None:
                continue
            total += 1
            if m >= HEAT_HIGH_C:
                high += 1
            elif m >= HEAT_ELEVATED_C:
                elevated += 1

        out.append({
            "t": int(h.timestamp() * 1000),
            "elevated": elevated,
            "high": high,
            "total": total,
        })
        h = h + timedelta(hours=1)

    return out


@app.get("/dashboard/temperature")
def dashboard_temperature(top_n: int = Query(default=5, ge=1, le=25)) -> Dict[str, Any]:
    rows = _fetch_rows_last_hours(48)
    latest = _latest_per_sensor(rows)
    now_utc = datetime.now(timezone.utc)

    rows_by_sensor: Dict[int, List[dict]] = {}
    for r in rows:
        rows_by_sensor.setdefault(int(r["sensor_id"]), []).append(r)

    # Heat risk (now)
    latest_temps: List[float] = []
    elevated_now = 0
    high_now = 0
    total_sensors_now = 0

    for _, lr in latest.items():
        temp = lr.get("celsius")
        if temp is None:
            continue
        total_sensors_now += 1
        ft = float(temp)
        latest_temps.append(ft)
        if ft >= HEAT_HIGH_C:
            high_now += 1
        elif ft >= HEAT_ELEVATED_C:
            elevated_now += 1

    city_now_temp = _mean(latest_temps)
    city_now_risk = _heat_risk_label(city_now_temp)

    # Hotspots (per sensor) + 24h trend only
    hotspots = []
    for sid, lr in latest.items():
        temp = lr.get("celsius")
        wm = _window_means(rows_by_sensor.get(sid, []), "celsius", now_utc)
        t24 = _trend_label(wm["24h"][0], wm["24h"][1])

        exceed = None
        if temp is not None:
            exceed = max(0.0, float(temp) - HEAT_ELEVATED_C)

        hotspots.append({
            "sensor_id": sid,
            "location_name": lr.get("location_name") or f"Sensor {sid}",
            "lat": lr.get("lat"),
            "lon": lr.get("lon"),
            "current_c": temp,
            "risk_label": _heat_risk_label(float(temp) if temp is not None else None),
            "threshold_exceedance_c": exceed,
            "last_update_utc": lr.get("ts_utc") or lr.get("created_at"),
            "trend_24h": t24,
        })

    hotspots_sorted = sorted(
        hotspots,
        key=lambda x: (x["current_c"] is not None, x["current_c"]),
        reverse=True
    )[:top_n]

    # City 24h trend only
    all_temp_rows = [r for r in rows if r.get("celsius") is not None]
    city_wm = _window_means(all_temp_rows, "celsius", now_utc)
    city_trend_24h = _trend_label(city_wm["24h"][0], city_wm["24h"][1])

    series_24h = _bucket_series(rows, "celsius", hours=24)
    heat_risk_series_24h = _heat_risk_series_24h(rows)

    return {
        "now_utc": now_utc.isoformat(),
        "thresholds": {
            "elevated_c": HEAT_ELEVATED_C,
            "high_c": HEAT_HIGH_C,
            "note": "Temp-only threshold (no humidity/humidex available)."
        },
        "heat_risk": {
            "city_now": {
                "risk_label": city_now_risk,
                "mean_c": city_now_temp,
                "elevated_sensors": elevated_now,
                "high_sensors": high_now,
                "total_reporting_sensors": total_sensors_now,
            },
            "series_24h": heat_risk_series_24h,
            "note": "Counts use per-sensor hourly mean temperature."
        },
        "top_hotspots_now": hotspots_sorted,
        "trend": {
            "city_24h": city_trend_24h,
        },
        "series_24h": series_24h,
    }

# AI METHODS
@app.post("/ai/sensor-analysis")
def ai_sensor_analysis(req: SensorAnalysisRequest) -> dict:
    """
    Requires (add near imports if missing):
      import json, math
      from openai import OpenAI
    Env:
      OPENAI_API_KEY (server-side), optional OPENAI_MODEL (defaults below)
    """

    import json
    import math
    from openai import OpenAI

    # --------- helpers (local to keep this drop-in) ---------
    def _ensure_utc(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    def _fmt_local(ts_utc: datetime) -> str:
        return ts_utc.astimezone(TORONTO_TZ).strftime("%Y-%m-%d %H:%M")

    def _pct(vals: list[float], p: float) -> float | None:
        if not vals:
            return None
        x = sorted(vals)
        if len(x) == 1:
            return float(x[0])
        k = (len(x) - 1) * (p / 100.0)
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return float(x[int(k)])
        return float(x[f] + (x[c] - x[f]) * (k - f))

    def _basic_stats(vals: list[float]) -> dict:
        if not vals:
            return {"n": 0, "mean": None, "min": None, "p50": None, "p90": None, "max": None}
        return {
            "n": len(vals),
            "mean": round(sum(vals) / len(vals), 3),
            "min": round(min(vals), 3),
            "p50": round(_pct(vals, 50) or 0.0, 3),
            "p90": round(_pct(vals, 90) or 0.0, 3),
            "max": round(max(vals), 3),
        }

    def _noise_threshold_for_local_hour(h: int) -> float:
        is_night = (h >= NOISE_NIGHT_START_H) or (h < NOISE_DAY_START_H)
        return NOISE_NIGHT_VIOLATION_DB if is_night else NOISE_DAY_VIOLATION_DB

    def _top_events(rows: list[dict], key: str, n: int = 5) -> list[dict]:
        items = []
        for r in rows:
            v = r.get(key)
            if v is None:
                continue
            ts = _parse_ts(r.get("ts_utc"))
            if ts is None:
                continue
            items.append((float(v), ts))
        items.sort(key=lambda t: t[0], reverse=True)
        out = []
        for v, ts in items[:n]:
            out.append({"t_local": _fmt_local(ts), "value": round(v, 3)})
        return out

    def _biggest_jumps(rows: list[dict], key: str, n: int = 5) -> list[dict]:
        pts = []
        for r in rows:
            v = r.get(key)
            ts = _parse_ts(r.get("ts_utc"))
            if v is None or ts is None:
                continue
            pts.append((ts, float(v)))
        pts.sort(key=lambda x: x[0])
        jumps = []
        for i in range(1, len(pts)):
            dt = (pts[i][0] - pts[i - 1][0]).total_seconds()
            if dt <= 0:
                continue
            dv = pts[i][1] - pts[i - 1][1]
            jumps.append((abs(dv), dv, pts[i][0], pts[i - 1][0]))
        jumps.sort(key=lambda x: x[0], reverse=True)
        out = []
        for _, dv, t2, t1 in jumps[:n]:
            out.append(
                {
                    "from_local": _fmt_local(t1),
                    "to_local": _fmt_local(t2),
                    "delta": round(dv, 3),
                }
            )
        return out

    # --------- validate / defaults ---------
    if not (req.message or "").strip():
        raise HTTPException(status_code=400, detail="message is required")

    if req.sensor_id is None:
        raise HTTPException(status_code=400, detail="sensor_id is required for analysis")

    end = _ensure_utc(req.end) if req.end else datetime.now(timezone.utc)
    start = _ensure_utc(req.start) if req.start else (end - timedelta(hours=24))
    if start > end:
        raise HTTPException(status_code=400, detail="start must be <= end")

    # hard cap window to avoid huge prompts/queries
    max_window = timedelta(days=7)
    if end - start > max_window:
        start = end - max_window

    # --------- fetch minimal rows from Supabase ---------
    res = (
        supabase.table(TABLE_NAME)
        .select("ts_utc,average_db,max_db,celsius,sensor_id,location_name,lat,lon")
        .eq("sensor_id", req.sensor_id)
        .gte("ts_utc", start.isoformat())
        .lte("ts_utc", end.isoformat())
        .order("ts_utc", desc=False)
        .limit(15000)
        .execute()
    )
    if res.data is None:
        raise HTTPException(status_code=500, detail="Supabase query failed")

    rows: list[dict] = res.data
    if len(rows) == 0:
        return {
            "reply": (
                f"No data found for sensor {req.sensor_id} in window "
                f"{start.astimezone(TORONTO_TZ).strftime('%Y-%m-%d %H:%M')} → "
                f"{end.astimezone(TORONTO_TZ).strftime('%Y-%m-%d %H:%M')} (local)."
            )
        }

    # --------- compute compact context for the model ---------
    loc_name = None
    lat = None
    lon = None
    for r in reversed(rows):
        if r.get("location_name"):
            loc_name = r.get("location_name")
        if lat is None and r.get("lat") is not None:
            lat = r.get("lat")
        if lon is None and r.get("lon") is not None:
            lon = r.get("lon")
        if loc_name and lat is not None and lon is not None:
            break

    # numeric series
    temps = [float(r["celsius"]) for r in rows if r.get("celsius") is not None]
    avgdb = [float(r["average_db"]) for r in rows if r.get("average_db") is not None]
    maxdb = [float(r["max_db"]) for r in rows if r.get("max_db") is not None]

    # violations (noise) per-reading, based on local hour
    noise_violations = 0
    noise_total = 0
    for r in rows:
        v = r.get("average_db")
        ts = _parse_ts(r.get("ts_utc"))
        if v is None or ts is None:
            continue
        h = ts.astimezone(TORONTO_TZ).hour
        thr = _noise_threshold_for_local_hour(h)
        noise_total += 1
        if float(v) >= thr:
            noise_violations += 1

    # heat categories
    elevated_ct = 0
    high_ct = 0
    for t in temps:
        if t >= HEAT_HIGH_C:
            high_ct += 1
        elif t >= HEAT_ELEVATED_C:
            elevated_ct += 1

    # last values (if present)
    last_ts = _parse_ts(rows[-1].get("ts_utc")) or end
    last_vals = {
        "t_local": _fmt_local(last_ts),
        "celsius": float(rows[-1]["celsius"]) if rows[-1].get("celsius") is not None else None,
        "average_db": float(rows[-1]["average_db"]) if rows[-1].get("average_db") is not None else None,
        "max_db": float(rows[-1]["max_db"]) if rows[-1].get("max_db") is not None else None,
    }

    context = {
        "sensor": {
            "sensor_id": req.sensor_id,
            "location_name": loc_name,
            "lat": lat,
            "lon": lon,
        },
        "window": {
            "start_utc": start.isoformat(),
            "end_utc": end.isoformat(),
            "start_local": start.astimezone(TORONTO_TZ).strftime("%Y-%m-%d %H:%M"),
            "end_local": end.astimezone(TORONTO_TZ).strftime("%Y-%m-%d %H:%M"),
            "row_count": len(rows),
            "note": "Data may be truncated if extremely dense (limit 15000 rows).",
        },
        "thresholds": {
            "heat_elevated_c": HEAT_ELEVATED_C,
            "heat_high_c": HEAT_HIGH_C,
            "noise_day_db": NOISE_DAY_VIOLATION_DB,
            "noise_night_db": NOISE_NIGHT_VIOLATION_DB,
            "noise_day_start_hour": NOISE_DAY_START_H,
            "noise_night_start_hour": NOISE_NIGHT_START_H,
        },
        "latest": last_vals,
        "stats": {
            "temperature_c": _basic_stats(temps),
            "average_db": _basic_stats(avgdb),
            "max_db": _basic_stats(maxdb),
            "heat_counts": {
                "elevated": elevated_ct,
                "high": high_ct,
                "total_temp_points": len(temps),
            },
            "noise_violations": {
                "violations": noise_violations,
                "total_db_points": noise_total,
                "violation_rate": round((noise_violations / noise_total), 4) if noise_total else None,
            },
        },
        "notable": {
            "top_max_db": _top_events(rows, "max_db", n=5),
            "top_avg_db": _top_events(rows, "average_db", n=5),
            "biggest_avg_db_jumps": _biggest_jumps(rows, "average_db", n=5),
            "biggest_temp_jumps": _biggest_jumps(rows, "celsius", n=5),
        },
    }

    meta = SENSOR_META.get(int(req.sensor_id))
    if meta:
        context["sensor"]["meta"] = meta
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"reply": "Server missing OPENAI_API_KEY. Set it in your backend environment."}

    model = os.getenv("OPENAI_MODEL", "gpt-5.2")
    client = OpenAI(api_key=api_key)

    instructions = (
        "You are MeshStat Assistant, a municipal-style sensor data analyst.\n"
        "Use only the provided context; do not invent readings or timestamps.\n"
        "Answer the user's question clearly and compactly.\n"
        "Output format (plain text, no markdown):\n"
        "1) One-line title: Sensor + window\n"
        "2) Summary (3-6 bullets)\n"
        "3) Notable events (up to 5 bullets; include local timestamps when available)\n"
        "4) Interpretation + next checks (2-5 bullets)\n"
        "If data is sparse, say what is missing and what would help."
        "Use sensor.meta as ground truth for location/context and expectations.\n"
    )

    user_input = (
        "USER QUESTION:\n"
        f"{req.message.strip()}\n\n"
        "CONTEXT (JSON):\n"
        f"{json.dumps(context, ensure_ascii=False)}"
    )

    resp = client.responses.create(
        model=model,
        instructions=instructions,
        input=user_input,
        temperature=0.2,
        max_output_tokens=450,
    )

    reply = (resp.output_text or "").strip() or "No reply returned."
    return {"reply": reply}


@app.post("/ai/sensor-predict", response_model=SensorPredictResponse)
def ai_sensor_predict(req: SensorPredictRequest) -> dict:
    try:
        models_dir = os.getenv("MODELS_DIR", "models")
        return predict_from_supabase(
            supabase_client=supabase,
            table_name=TABLE_NAME,
            sensor_id=req.sensor_id,
            metric=req.metric,          # "celsius" or "average_db"
            future_ts_utc=req.future_ts_utc,
            models_dir=models_dir,
            lookback_hours=72,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)







