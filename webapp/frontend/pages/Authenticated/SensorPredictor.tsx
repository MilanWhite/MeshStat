// src/pages/AITools/SensorPredictor.tsx
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../../components/Sidebar";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

type SensorInfo = {
	sensor_id: number;
	location_name?: string | null;
	lat?: number | null;
	lon?: number | null;
};

type SensorsResponse = { count: number; rows: SensorInfo[] };

type Metric = "celsius" | "average_db";

type PredictResponse = {
	sensor_id: number;
	metric: Metric;
	future_ts_utc: string;
	prediction: number;
	unit: string;
	model?: string;
	note?: string;
};

function toDatetimeLocalValue(d: Date) {
	const pad = (n: number) => String(n).padStart(2, "0");
	const yyyy = d.getFullYear();
	const mm = pad(d.getMonth() + 1);
	const dd = pad(d.getDate());
	const hh = pad(d.getHours());
	const min = pad(d.getMinutes());
	return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function clampDate(d: Date, min: Date, max: Date) {
	const t = d.getTime();
	const tMin = min.getTime();
	const tMax = max.getTime();
	if (t < tMin) return new Date(tMin);
	if (t > tMax) return new Date(tMax);
	return d;
}

function Card({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
			<div className="text-sm font-semibold mb-2">{title}</div>
			{children}
		</div>
	);
}

function Pill({ children }: { children: React.ReactNode }) {
	return (
		<span className="inline-flex items-center rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/80">
			{children}
		</span>
	);
}

function fmtNum(n: number, maxFrac = 1) {
	return new Intl.NumberFormat(undefined, {
		maximumFractionDigits: maxFrac,
	}).format(n);
}

function metricLabel(m: Metric) {
	return m === "celsius" ? "Temperature" : "Noise";
}

export default function SensorPredictor() {
	const [sensors, setSensors] = useState<SensorInfo[]>([]);
	const [sensorId, setSensorId] = useState<number | null>(null);
	const [metric, setMetric] = useState<Metric>("celsius");

	// --- 24h horizon window computed from "now" (kept fresh) ---
	const [nowTick, setNowTick] = useState<number>(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
		return () => window.clearInterval(id);
	}, []);

	const minFutureDate = useMemo(() => new Date(nowTick), [nowTick]);
	const maxFutureDate = useMemo(
		() => new Date(nowTick + 24 * 60 * 60 * 1000),
		[nowTick]
	);

	const minFutureAtStr = useMemo(
		() => toDatetimeLocalValue(minFutureDate),
		[minFutureDate]
	);
	const maxFutureAtStr = useMemo(
		() => toDatetimeLocalValue(maxFutureDate),
		[maxFutureDate]
	);

	const [futureAt, setFutureAt] = useState<string>(() =>
		toDatetimeLocalValue(new Date(Date.now() + 2 * 60 * 60 * 1000))
	);

	const [loadingSensors, setLoadingSensors] = useState(false);
	const [predicting, setPredicting] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const [result, setResult] = useState<PredictResponse | null>(null);

	// Clamp initial futureAt into [now, now+24h] once window is known/updates
	useEffect(() => {
		const d = new Date(futureAt);
		if (Number.isNaN(d.getTime())) return;
		const clamped = clampDate(d, minFutureDate, maxFutureDate);
		const next = toDatetimeLocalValue(clamped);
		if (next !== futureAt) setFutureAt(next);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [minFutureAtStr, maxFutureAtStr]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setErr(null);
			setLoadingSensors(true);
			try {
				const res = await fetch(`${API_BASE}/sensors`);
				if (!res.ok)
					throw new Error(`Sensors fetch failed: ${res.status}`);
				const json = (await res.json()) as SensorsResponse;
				if (cancelled) return;

				const rows = json.rows ?? [];
				setSensors(rows);
				if (rows.length > 0)
					setSensorId((prev) => prev ?? rows[0].sensor_id);
			} catch (e: any) {
				if (!cancelled) setErr(e?.message ?? "Failed to load sensors");
			} finally {
				if (!cancelled) setLoadingSensors(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	const selectedSensor = useMemo(
		() => sensors.find((x) => x.sensor_id === sensorId) ?? null,
		[sensors, sensorId]
	);

	const selectedSensorLabel = useMemo(() => {
		if (!selectedSensor)
			return sensorId ? `Sensor ${sensorId}` : "No sensor";
		return selectedSensor.location_name
			? `Sensor ${selectedSensor.sensor_id} — ${selectedSensor.location_name}`
			: `Sensor ${selectedSensor.sensor_id}`;
	}, [selectedSensor, sensorId]);

	const futureDateObj = useMemo(() => new Date(futureAt), [futureAt]);

	const horizonMinutes = useMemo(() => {
		const t = futureDateObj.getTime();
		if (Number.isNaN(t)) return null;
		return Math.round((t - minFutureDate.getTime()) / 60000);
	}, [futureDateObj, minFutureDate]);

	const futureInRange = useMemo(() => {
		const t = futureDateObj.getTime();
		if (Number.isNaN(t)) return false;
		return t >= minFutureDate.getTime() && t <= maxFutureDate.getTime();
	}, [futureDateObj, minFutureDate, maxFutureDate]);

	function onFutureChange(v: string) {
		// Clamp manual typing/selection into range
		const d = new Date(v);
		if (Number.isNaN(d.getTime())) {
			setFutureAt(v);
			return;
		}
		const clamped = clampDate(d, minFutureDate, maxFutureDate);
		setFutureAt(toDatetimeLocalValue(clamped));
	}

	async function predict() {
		if (sensorId == null || predicting) return;

		// Enforce 24h horizon client-side even if someone bypasses input constraints
		if (!futureInRange) {
			setErr("Future time must be within the next 24 hours.");
			return;
		}

		setErr(null);
		setPredicting(true);
		setResult(null);

		try {
			const res = await fetch(`${API_BASE}/ai/sensor-predict`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sensor_id: sensorId,
					metric, // "celsius" | "average_db"
					future_ts_utc: new Date(futureAt).toISOString(),
				}),
			});

			if (!res.ok) {
				const t = await res.text().catch(() => "");
				throw new Error(
					`Predict failed: ${res.status}${
						t ? `\n${t.slice(0, 200)}` : ""
					}`
				);
			}

			const json = (await res.json()) as PredictResponse;
			setResult(json);
		} catch (e: any) {
			setErr(e?.message ?? "Failed to predict");
		} finally {
			setPredicting(false);
		}
	}

	const futureLocal = useMemo(() => {
		const d = new Date(futureAt);
		return Number.isNaN(d.getTime()) ? "Invalid date" : d.toLocaleString();
	}, [futureAt]);

	const prettyValue = useMemo(() => {
		if (!result) return null;
		const maxFrac = result.metric === "celsius" ? 1 : 1;
		return `${fmtNum(result.prediction, maxFrac)} ${(
			result.unit ?? ""
		).trim()}`.trim();
	}, [result]);

	const riskHint = useMemo(() => {
		if (!result) return null;
		if (result.metric !== "celsius") return null;
		const v = result.prediction;
		if (v >= 31)
			return {
				label: "High heat risk",
				tone: "bg-red-500/15 border-red-500/30 text-red-200",
			};
		if (v >= 26)
			return {
				label: "Elevated heat risk",
				tone: "bg-amber-500/15 border-amber-500/30 text-amber-200",
			};
		return {
			label: "Normal",
			tone: "bg-emerald-500/15 border-emerald-500/30 text-emerald-200",
		};
	}, [result]);

	return (
		<Sidebar>
			<div className="w-full h-full flex flex-col gap-3">
				<h1 className="text-4xl font-bold tracking-tight text-heading md:text-5xl lg:text-4xl">
					Sensor Predictor
				</h1>
				<p className="mb-4 text-lg text-body">
					Request a future prediction for a sensor + metric.
				</p>

				<div className="w-full h-full flex flex-col gap-4">
					<div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
						<select
							value={sensorId ?? ""}
							onChange={(e) =>
								setSensorId(Number(e.target.value))
							}
							className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
							disabled={loadingSensors || sensors.length === 0}
						>
							{sensors.map((s) => (
								<option
									key={s.sensor_id}
									value={s.sensor_id}
									className="bg-zinc-700"
								>
									{s.location_name
										? `Sensor ${s.sensor_id} — ${s.location_name}`
										: `Sensor ${s.sensor_id}`}
								</option>
							))}
						</select>

						<div className="flex items-center gap-2">
							<label className="text-xs opacity-80">Metric</label>
							<select
								value={metric}
								onChange={(e) =>
									setMetric(e.target.value as Metric)
								}
								className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
							>
								<option value="celsius" className="bg-zinc-700">
									Temperature (°C)
								</option>
								<option
									value="average_db"
									className="bg-zinc-700"
								>
									Noise (dB)
								</option>
							</select>
						</div>

						<div className="flex items-center gap-2">
							<label className="text-xs opacity-80">
								Future time
							</label>
							<input
								type="datetime-local"
								value={futureAt}
								min={minFutureAtStr}
								max={maxFutureAtStr}
								onChange={(e) => onFutureChange(e.target.value)}
								className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm [color-scheme:dark]"
							/>
						</div>

						<button
							onClick={predict}
							className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm"
							type="button"
							disabled={
								predicting || sensorId == null || !futureInRange
							}
							title={
								!futureInRange
									? "Choose a time within the next 24 hours"
									: "Predict"
							}
						>
							Predict
						</button>

						<div className="ml-auto flex items-center gap-3">
							<div className="text-xs opacity-80">
								{selectedSensorLabel}
							</div>
							{predicting && (
								<div className="text-xs opacity-80">
									Predicting…
								</div>
							)}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-2 text-xs opacity-75">
						<Pill>Max horizon: 24h</Pill>
						<Pill>
							Allowed: {minFutureAtStr.replace("T", " ")} →{" "}
							{maxFutureAtStr.replace("T", " ")}
						</Pill>
						{horizonMinutes != null && (
							<Pill>Horizon: {horizonMinutes} min</Pill>
						)}
						{!futureInRange && <Pill>Out of range</Pill>}
					</div>

					{err && (
						<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
							{err}
						</div>
					)}

					<Card title="Prediction">
						{!result ? (
							<div className="rounded-xl border border-white/10 bg-black/10 p-4">
								<div className="text-sm font-semibold">
									No result yet
								</div>
								<div className="mt-1 text-xs opacity-80">
									Ready to predict{" "}
									<span className="font-semibold">
										{metricLabel(metric)}
									</span>{" "}
									for{" "}
									<span className="font-semibold">
										{selectedSensorLabel}
									</span>{" "}
									at{" "}
									<span className="font-semibold">
										{futureLocal}
									</span>
									.
								</div>
							</div>
						) : (
							<div className="rounded-xl border border-white/10 bg-black/10 p-4">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<div className="text-xs opacity-70">
											Predicted
										</div>
										<div className="mt-1 text-3xl font-bold tracking-tight">
											{prettyValue}
										</div>
										<div className="mt-2 flex flex-wrap gap-2">
											<Pill>
												{metricLabel(result.metric)}
											</Pill>
											<Pill>{selectedSensorLabel}</Pill>
											<Pill>
												{new Date(
													futureAt
												).toLocaleString()}
											</Pill>
										</div>
									</div>

									{riskHint && (
										<span
											className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${riskHint.tone}`}
										>
											{riskHint.label}
										</span>
									)}
								</div>

								<div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
									<div className="rounded-xl border border-white/10 bg-white/5 p-3">
										<div className="text-xs opacity-70">
											Sensor
										</div>
										<div className="mt-1 text-sm font-semibold">
											{result.sensor_id}
										</div>
										{selectedSensor?.lat != null &&
											selectedSensor?.lon != null && (
												<div className="mt-1 text-xs opacity-70">
													{fmtNum(
														selectedSensor.lat,
														5
													)}
													,{" "}
													{fmtNum(
														selectedSensor.lon,
														5
													)}
												</div>
											)}
									</div>

									<div className="rounded-xl border border-white/10 bg-white/5 p-3">
										<div className="text-xs opacity-70">
											Metric
										</div>
										<div className="mt-1 text-sm font-semibold">
											{result.metric === "celsius"
												? "Temperature (°C)"
												: "Noise (dBA)"}
										</div>
										<div className="mt-1 text-xs opacity-70">
											Unit: {result.unit}
										</div>
									</div>

									<div className="rounded-xl border border-white/10 bg-white/5 p-3">
										<div className="text-xs opacity-70">
											Model
										</div>
										<div className="mt-1 text-sm font-semibold">
											{result.model ?? "—"}
										</div>
										<div className="mt-1 text-xs opacity-70">
											Target (UTC):{" "}
											{new Date(
												result.future_ts_utc
											).toISOString()}
										</div>
									</div>
								</div>

								{result.note && (
									<div className="mt-3 text-xs opacity-75 rounded-xl border border-white/10 bg-white/5 p-3">
										<span className="font-semibold">
											Note:
										</span>{" "}
										{result.note}
									</div>
								)}

								<details className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3">
									<summary className="cursor-pointer text-sm font-semibold opacity-90 select-none">
										Raw response
									</summary>
									<pre className="mt-3 overflow-x-auto text-xs opacity-80">
										{JSON.stringify(result, null, 2)}
									</pre>
								</details>
							</div>
						)}
					</Card>
				</div>
			</div>
		</Sidebar>
	);
}
