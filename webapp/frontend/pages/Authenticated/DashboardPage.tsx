// src/pages/Dashboard/DashboardPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "../../components/Sidebar";
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { SensorDataTooltip } from "../../components/SensorDataCharts/SensorDataTooltip/SensorDataTooltip";

type TrendLabel = "Improving" | "Worsening" | "Stable" | "Unknown";

type TempHotspot = {
	sensor_id: number;
	location_name: string;
	lat: number | null;
	lon: number | null;
	current_c: number | null;
	risk_label: "Normal" | "Elevated" | "High" | "Unknown";
	threshold_exceedance_c: number | null;
	last_update_utc: string | null;
	trend_24h: TrendLabel;
};

type NoiseHotspot = {
	sensor_id: number;
	location_name: string;
	lat: number | null;
	lon: number | null;
	current_avg_db: number | null;
	threshold_db: number;
	threshold_exceedance_db: number | null;
	is_violation_proxy: boolean;
	last_update_utc: string | null;
	trend_24h: TrendLabel;
};

type SeriesPoint = { t: number; value: number | null };

type HeatRiskSeriesPoint = {
	t: number;
	elevated: number;
	high: number;
	total: number;
};

type HeatRiskNow = {
	risk_label: "Normal" | "Elevated" | "High" | "Unknown";
	mean_c: number | null;
	elevated_sensors: number;
	high_sensors: number;
	total_reporting_sensors: number;
};

type TempDashboardResponse = {
	now_utc: string;
	thresholds: { elevated_c: number; high_c: number; note: string };
	heat_risk?: {
		city_now: HeatRiskNow;
		series_24h: HeatRiskSeriesPoint[];
		note?: string;
	};
	top_hotspots_now: TempHotspot[];
	trend: { city_24h: TrendLabel };
	series_24h: SeriesPoint[];
};

type NoiseDashboardResponse = {
	now_utc: string;
	now_local: string;
	thresholds: {
		day_db: number;
		night_db: number;
		current_db: number;
		note: string;
	};
	top_hotspots_now: NoiseHotspot[];
	noise_violations: NoiseHotspot[];
	trend: { city_24h: TrendLabel };
	series_24h: SeriesPoint[];
};

type LatestRowApi = {
	sensor_id: number;
	location_name?: string | null;
	lat?: number | null;
	lon?: number | null;

	ts_utc?: string | null;
	created_at?: string | null;

	average_db?: number | null;
	max_db?: number | null;
	celsius?: number | null;
};

type LatestResponse = { count: number; rows: LatestRowApi[] };

type RangeRowApi = LatestRowApi;

type RangeResponse = {
	start: string;
	end: string;
	time_column: "ts_utc" | "created_at";
	count: number;
	by_sensor: Record<string, RangeRowApi[]>;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

const TORONTO_TZ = "America/Toronto";

// keep aligned with your backend constants
const HEAT_ELEVATED_C = 26.0;
const HEAT_HIGH_C = 31.0;

const NOISE_DAY_START_H = 7;
const NOISE_NIGHT_START_H = 21;
const NOISE_DAY_VIOLATION_DB = 65.0;
const NOISE_NIGHT_VIOLATION_DB = 55.0;

function formatTime(ms: number) {
	return new Intl.DateTimeFormat(undefined, {
		timeZone: TORONTO_TZ,
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(ms));
}

/**
 * If backend returns ISO without timezone (e.g. "2026-01-15T12:00:00"),
 * JS treats it as *local time*; force UTC by appending "Z". :contentReference[oaicite:1]{index=1}
 */
function parseIsoAssumeUtcMs(iso: string | null | undefined): number | null {
	if (!iso) return null;

	const s = String(iso).trim();
	// already has timezone info: ...Z or ...+00:00 / ...-05:00
	const hasTz =
		/[zZ]$/.test(s) || /[+\-]\d{2}:\d{2}$/.test(s) || /[+\-]\d{4}$/.test(s);

	const d = new Date(hasTz ? s : `${s}Z`);
	const ms = d.getTime();
	return Number.isNaN(ms) ? null : ms;
}

function fmtISOToLocal(iso: string | null) {
	const ms = parseIsoAssumeUtcMs(iso);
	if (ms == null) return "—";
	return new Date(ms).toLocaleString(undefined, { timeZone: TORONTO_TZ });
}

function mean(nums: number[]): number | null {
	if (nums.length === 0) return null;
	let s = 0;
	for (const n of nums) s += n;
	return s / nums.length;
}

function trendLabel(currMean: number | null, prevMean: number | null, eps = 0.15): TrendLabel {
	if (currMean == null || prevMean == null) return "Unknown";
	const delta = currMean - prevMean;
	if (Math.abs(delta) <= eps) return "Stable";
	return delta > 0 ? "Worsening" : "Improving";
}

function heatRiskLabel(tempC: number | null): "Normal" | "Elevated" | "High" | "Unknown" {
	if (tempC == null) return "Unknown";
	if (tempC >= HEAT_HIGH_C) return "High";
	if (tempC >= HEAT_ELEVATED_C) return "Elevated";
	return "Normal";
}

function getTorontoHour(d: Date): number {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: TORONTO_TZ,
		hour: "2-digit",
		hour12: false,
	}).formatToParts(d);
	const hh = parts.find((p) => p.type === "hour")?.value ?? "0";
	return Number(hh);
}

function currentNoiseThreshold(now: Date): number {
	const h = getTorontoHour(now);
	const isNight = h >= NOISE_NIGHT_START_H || h < NOISE_DAY_START_H;
	return isNight ? NOISE_NIGHT_VIOLATION_DB : NOISE_DAY_VIOLATION_DB;
}

function Badge({ label }: { label: string }) {
	const tone =
		label === "High" || label === "Worsening"
			? "bg-red-500/15 border-red-500/30 text-red-200"
			: label === "Elevated"
			? "bg-amber-500/15 border-amber-500/30 text-amber-200"
			: label === "Improving"
			? "bg-emerald-500/15 border-emerald-500/30 text-emerald-200"
			: "bg-white/10 border-white/10 text-white/80";

	return (
		<span
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}
		>
			{label}
		</span>
	);
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
			<div className="text-sm font-semibold mb-2">{title}</div>
			{children}
		</div>
	);
}

type BuiltDashboard = {
	temp: TempDashboardResponse;
	noise: NoiseDashboardResponse;
};

function buildDashboardFromApi(latestRows: LatestRowApi[], range: RangeResponse, now: Date): BuiltDashboard {
	const nowUtcIso = now.toISOString();
	const nowLocalIso = new Date(now.getTime()).toLocaleString("sv-SE", { timeZone: TORONTO_TZ }).replace(" ", "T");

	const noiseThrNow = currentNoiseThreshold(now);

	// Index range rows by sensor with parsed ms
	const rangeBySensorMs: Record<number, Array<{ ms: number; row: RangeRowApi }>> = {};
	for (const [sidStr, rows] of Object.entries(range.by_sensor ?? {})) {
		const sid = Number(sidStr);
		const arr: Array<{ ms: number; row: RangeRowApi }> = [];
		for (const r of rows ?? []) {
			const ms = parseIsoAssumeUtcMs(r.ts_utc ?? r.created_at);
			if (ms == null) continue;
			arr.push({ ms, row: r });
		}
		arr.sort((a, b) => a.ms - b.ms);
		rangeBySensorMs[sid] = arr;
	}

	const nowMs = now.getTime();
	const start24Ms = nowMs - 24 * 60 * 60 * 1000;
	const start48Ms = nowMs - 48 * 60 * 60 * 1000;

	function windowMeanForSensor(sid: number, key: "celsius" | "average_db", a: number, b: number): number | null {
		const arr = rangeBySensorMs[sid] ?? [];
		const vals: number[] = [];
		for (const it of arr) {
			if (it.ms < a || it.ms > b) continue;
			const v = it.row[key];
			if (typeof v === "number") vals.push(v);
		}
		return mean(vals);
	}

	function cityWindowMean(key: "celsius" | "average_db", a: number, b: number): number | null {
		const vals: number[] = [];
		for (const it of Object.values(rangeBySensorMs)) {
			for (const p of it) {
				if (p.ms < a || p.ms > b) continue;
				const v = p.row[key];
				if (typeof v === "number") vals.push(v);
			}
		}
		return mean(vals);
	}

	// City series 24h: bucket by hour (UTC epoch ms buckets)
	function citySeries24h(key: "celsius" | "average_db"): SeriesPoint[] {
		const bucketMs = 60 * 60 * 1000;

		const buckets = new Map<number, number[]>();
		for (const it of Object.values(rangeBySensorMs)) {
			for (const p of it) {
				if (p.ms < start24Ms || p.ms > nowMs) continue;
				const v = p.row[key];
				if (typeof v !== "number") continue;
				const t0 = Math.floor(p.ms / bucketMs) * bucketMs;
				let arr = buckets.get(t0);
				if (!arr) {
					arr = [];
					buckets.set(t0, arr);
				}
				arr.push(v);
			}
		}

		const out: SeriesPoint[] = [];
		const startHour = Math.floor(start24Ms / bucketMs) * bucketMs;
		const endHour = Math.floor(nowMs / bucketMs) * bucketMs;

		for (let t = startHour; t <= endHour; t += bucketMs) {
			const m = mean(buckets.get(t) ?? []);
			out.push({ t, value: m });
		}
		return out;
	}

	// Heat risk series 24h: per hour, per sensor mean -> count sensors exceeding thresholds
	function heatRiskSeries24h(): HeatRiskSeriesPoint[] {
		const bucketMs = 60 * 60 * 1000;

		// hour -> sensor -> temp vals
		const hourMap = new Map<number, Map<number, number[]>>();
		for (const [sid, arr] of Object.entries(rangeBySensorMs)) {
			const sensorId = Number(sid);
			for (const p of arr) {
				if (p.ms < start24Ms || p.ms > nowMs) continue;
				const v = p.row.celsius;
				if (typeof v !== "number") continue;

				const h0 = Math.floor(p.ms / bucketMs) * bucketMs;
				let perSensor = hourMap.get(h0);
				if (!perSensor) {
					perSensor = new Map<number, number[]>();
					hourMap.set(h0, perSensor);
				}
				let vals = perSensor.get(sensorId);
				if (!vals) {
					vals = [];
					perSensor.set(sensorId, vals);
				}
				vals.push(v);
			}
		}

		const out: HeatRiskSeriesPoint[] = [];
		const startHour = Math.floor(start24Ms / bucketMs) * bucketMs;
		const endHour = Math.floor(nowMs / bucketMs) * bucketMs;

		for (let t = startHour; t <= endHour; t += bucketMs) {
			const perSensor = hourMap.get(t) ?? new Map<number, number[]>();

			let elevated = 0;
			let high = 0;
			let total = 0;

			for (const vals of perSensor.values()) {
				const m = mean(vals);
				if (m == null) continue;
				total += 1;
				if (m >= HEAT_HIGH_C) high += 1;
				else if (m >= HEAT_ELEVATED_C) elevated += 1;
			}

			out.push({ t, elevated, high, total });
		}

		return out;
	}

	// Build "now" from latest rows
	const tempsNow: number[] = [];
	let elevatedNow = 0;
	let highNow = 0;
	let totalTempNow = 0;

	const noiseNowVals: Array<{ sid: number; db: number }> = [];

	for (const r of latestRows) {
		if (typeof r.celsius === "number") {
			totalTempNow += 1;
			tempsNow.push(r.celsius);
			if (r.celsius >= HEAT_HIGH_C) highNow += 1;
			else if (r.celsius >= HEAT_ELEVATED_C) elevatedNow += 1;
		}
		if (typeof r.average_db === "number") {
			noiseNowVals.push({ sid: r.sensor_id, db: r.average_db });
		}
	}

	const cityNowTemp = mean(tempsNow);
	const cityNowRisk = heatRiskLabel(cityNowTemp);

	// Trends (city 24h vs previous 24h)
	const cityTempMean24 = cityWindowMean("celsius", start24Ms, nowMs);
	const cityTempMeanPrev24 = cityWindowMean("celsius", start48Ms, start24Ms);
	const cityTempTrend24 = trendLabel(cityTempMean24, cityTempMeanPrev24);

	const cityNoiseMean24 = cityWindowMean("average_db", start24Ms, nowMs);
	const cityNoiseMeanPrev24 = cityWindowMean("average_db", start48Ms, start24Ms);
	const cityNoiseTrend24 = trendLabel(cityNoiseMean24, cityNoiseMeanPrev24);

	// Per-sensor trend24h (last 24 vs prev 24)
	function sensorTrend24h(sid: number, key: "celsius" | "average_db"): TrendLabel {
		const m1 = windowMeanForSensor(sid, key, start24Ms, nowMs);
		const m0 = windowMeanForSensor(sid, key, start48Ms, start24Ms);
		return trendLabel(m1, m0);
	}

	const tempHotspots: TempHotspot[] = latestRows.map((r) => {
		const temp = typeof r.celsius === "number" ? r.celsius : null;
		const exceed = temp == null ? null : Math.max(0, temp - HEAT_ELEVATED_C);
		const lastUpdate = r.ts_utc ?? r.created_at ?? null;

		return {
			sensor_id: r.sensor_id,
			location_name: (r.location_name ?? `Sensor ${r.sensor_id}`) as string,
			lat: (typeof r.lat === "number" ? r.lat : null) as number | null,
			lon: (typeof r.lon === "number" ? r.lon : null) as number | null,
			current_c: temp,
			risk_label: heatRiskLabel(temp),
			threshold_exceedance_c: exceed,
			last_update_utc: lastUpdate,
			trend_24h: sensorTrend24h(r.sensor_id, "celsius"),
		};
	});

	const topTempHotspots = [...tempHotspots]
		.sort((a, b) => {
			const av = a.current_c;
			const bv = b.current_c;
			if (av == null && bv == null) return 0;
			if (av == null) return 1;
			if (bv == null) return -1;
			return bv - av;
		})
		.slice(0, 5);

	const noiseHotspots: NoiseHotspot[] = latestRows.map((r) => {
		const db = typeof r.average_db === "number" ? r.average_db : null;
		const exceed = db == null ? null : Math.max(0, db - noiseThrNow);
		const isViolation = db == null ? false : db >= noiseThrNow;
		const lastUpdate = r.ts_utc ?? r.created_at ?? null;

		return {
			sensor_id: r.sensor_id,
			location_name: (r.location_name ?? `Sensor ${r.sensor_id}`) as string,
			lat: (typeof r.lat === "number" ? r.lat : null) as number | null,
			lon: (typeof r.lon === "number" ? r.lon : null) as number | null,
			current_avg_db: db,
			threshold_db: noiseThrNow,
			threshold_exceedance_db: exceed,
			is_violation_proxy: isViolation,
			last_update_utc: lastUpdate,
			trend_24h: sensorTrend24h(r.sensor_id, "average_db"),
		};
	});

	const topNoiseHotspots = [...noiseHotspots]
		.sort((a, b) => {
			const av = a.current_avg_db;
			const bv = b.current_avg_db;
			if (av == null && bv == null) return 0;
			if (av == null) return 1;
			if (bv == null) return -1;
			return bv - av;
		})
		.slice(0, 5);

	const noiseViolations = noiseHotspots.filter((h) => h.is_violation_proxy);

	const temp: TempDashboardResponse = {
		now_utc: nowUtcIso,
		thresholds: {
			elevated_c: HEAT_ELEVATED_C,
			high_c: HEAT_HIGH_C,
			note: "Temp-only threshold (no humidity/humidex available).",
		},
		heat_risk: {
			city_now: {
				risk_label: cityNowRisk,
				mean_c: cityNowTemp,
				elevated_sensors: elevatedNow,
				high_sensors: highNow,
				total_reporting_sensors: totalTempNow,
			},
			series_24h: heatRiskSeries24h(),
			note: "Counts use per-sensor hourly mean temperature.",
		},
		top_hotspots_now: topTempHotspots,
		trend: { city_24h: cityTempTrend24 },
		series_24h: citySeries24h("celsius"),
	};

	const noise: NoiseDashboardResponse = {
		now_utc: nowUtcIso,
		now_local: nowLocalIso,
		thresholds: {
			day_db: NOISE_DAY_VIOLATION_DB,
			night_db: NOISE_NIGHT_VIOLATION_DB,
			current_db: noiseThrNow,
			note: "Threshold based on measured dBA + day/night; Kingston bylaw itself is activity/time-based.",
		},
		top_hotspots_now: topNoiseHotspots,
		noise_violations: noiseViolations,
		trend: { city_24h: cityNoiseTrend24 },
		series_24h: citySeries24h("average_db"),
	};

	return { temp, noise };
}

export default function DashboardPage() {
	const [temp, setTemp] = useState<TempDashboardResponse | null>(null);
	const [noise, setNoise] = useState<NoiseDashboardResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	async function load() {
		setErr(null);
		setLoading(true);
		try {
			const now = new Date();
			const endISO = now.toISOString();
			const start48ISO = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

			const [latestRes, rangeRes] = await Promise.all([
				fetch(`${API_BASE}/sensor-data/latest`),
				fetch(
					`${API_BASE}/sensor-data/range?start=${encodeURIComponent(
						start48ISO
					)}&end=${encodeURIComponent(endISO)}&time_column=ts_utc`
				),
			]);

			if (!latestRes.ok) throw new Error(`Latest failed: ${latestRes.status}`);
			if (!rangeRes.ok) throw new Error(`Range failed: ${rangeRes.status}`);

			const latestJson = (await latestRes.json()) as LatestResponse;
			const rangeJson = (await rangeRes.json()) as RangeResponse;

			const built = buildDashboardFromApi(latestJson.rows ?? [], rangeJson, now);
			setTemp(built.temp);
			setNoise(built.noise);
		} catch (e: any) {
			setErr(e?.message ?? "Failed to load dashboard");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		let cancelled = false;
		(async () => {
			await load();
			if (cancelled) return;
		})();

		const id = window.setInterval(() => {
			if (!cancelled) load();
		}, 30_000);

		return () => {
			cancelled = true;
			window.clearInterval(id);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const tempSeries = useMemo(
		() =>
			(temp?.series_24h ?? []).map((p) => ({
				t: p.t,
				celsius: typeof p.value === "number" ? p.value : null,
			})),
		[temp]
	);

	const noiseSeries = useMemo(
		() =>
			(noise?.series_24h ?? []).map((p) => ({
				t: p.t,
				average_db: typeof p.value === "number" ? p.value : null,
			})),
		[noise]
	);

	const heatRiskSeries = useMemo(() => {
		const s = temp?.heat_risk?.series_24h ?? [];
		return s.map((p) => ({
			t: p.t,
			elevated: p.elevated,
			high: p.high,
			total: p.total,
		}));
	}, [temp]);

	const noiseViolationCount = noise?.noise_violations?.length ?? 0;
	const cityHeatNow = temp?.heat_risk?.city_now;

	return (
		<Sidebar>
			<div className="w-full h-full flex flex-col gap-3">
				<h1 className="text-4xl font-bold tracking-tight text-heading md:text-5xl lg:text-4xl">
					Dashboard
				</h1>
				<p className="mb-4 text-lg text-body">
					Analyze real-time temperature and sound data from our sensors across the city.
				</p>

				<div className="w-full h-full flex flex-col gap-4">
					<div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
						<div className="text-xs opacity-80">
							Updates every 30s (America/Toronto).{" "}
							{temp?.now_utc ? `Last fetch: ${fmtISOToLocal(temp.now_utc)}` : ""}
						</div>

						<div className="ml-auto flex items-center gap-2">
							{loading && <div className="text-xs opacity-80">Loading…</div>}
							<button
								onClick={load}
								className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm"
								type="button"
								disabled={loading}
							>
								Refresh
							</button>
						</div>
					</div>

					{err && (
						<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
							{err}
						</div>
					)}

					<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
						{/* Temperature */}
						<div className="flex flex-col gap-4">
							<Card title="Temperature (24h trend)">
								<div className="flex flex-wrap items-center gap-3 text-xs opacity-80 mb-2">
									<span>
										City 24h: <Badge label={temp?.trend.city_24h ?? "Unknown"} />
									</span>
									<span>
										High ≥ {temp?.thresholds.high_c ?? HEAT_HIGH_C}°C{" "}
									</span>
								</div>

								<div className="h-[320px]">
									<ResponsiveContainer width="100%" height="100%">
										<LineChart
											data={tempSeries}
											margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
										>
											<CartesianGrid strokeDasharray="3 3" opacity={0.15} />
											<XAxis
												dataKey="t"
												type="number"
												domain={["dataMin", "dataMax"]}
												tickFormatter={formatTime}
												tick={{ fontSize: 12, opacity: 0.8 }}
											/>
											<YAxis
												tick={{ fontSize: 12, opacity: 0.8 }}
												label={{ value: "°C", angle: -90, position: "insideLeft" }}
											/>
											<Tooltip
												content={
													<SensorDataTooltip
														labelFormatterMs={formatTime}
														nameMap={{ celsius: "Temperature (°C)" }}
													/>
												}
												cursor={{
													stroke: "rgba(255,255,255,0.18)",
													strokeDasharray: "4 4",
												}}
											/>
											<Legend />
											<Line
												type="monotone"
												dataKey="celsius"
												name="Temperature"
												dot={false}
												connectNulls={false}
												strokeWidth={2}
												stroke={"#8e28c1"}
											/>
										</LineChart>
									</ResponsiveContainer>
								</div>
							</Card>

							<Card title="Heat risk">
								<div className="flex flex-wrap items-center gap-3 text-xs opacity-80 mb-3">
									<span>
										City now: <Badge label={cityHeatNow?.risk_label ?? "Unknown"} />
									</span>
									<span>
										Mean:{" "}
										<span className="font-semibold">
											{typeof cityHeatNow?.mean_c === "number"
												? `${cityHeatNow.mean_c.toFixed(1)}°C`
												: "—"}
										</span>
									</span>
									<span>
										Elevated:{" "}
										<span className="font-semibold">{cityHeatNow?.elevated_sensors ?? 0}</span>
									</span>
									<span>
										High: <span className="font-semibold">{cityHeatNow?.high_sensors ?? 0}</span>
									</span>
									<span>
										Reporting:{" "}
										<span className="font-semibold">{cityHeatNow?.total_reporting_sensors ?? 0}</span>
									</span>
									<span className="opacity-60">
										Thresholds: Elevated ≥ {temp?.thresholds.elevated_c ?? HEAT_ELEVATED_C}°C, High ≥{" "}
										{temp?.thresholds.high_c ?? HEAT_HIGH_C}°C
									</span>
								</div>

								{(() => {
									const s = temp?.heat_risk?.series_24h ?? [];
									const hasAnyRisk = s.some((p) => (p.elevated ?? 0) > 0 || (p.high ?? 0) > 0);
									const hasAnyData = s.length > 0;

									if (!hasAnyData || !hasAnyRisk) {
										return (
											<div className="rounded-xl border border-white/10 bg-black/10 p-4">
												<div className="text-sm font-semibold">No elevated heat risk</div>
												<div className="mt-1 text-xs opacity-80">
													No sensors exceeded {temp?.thresholds.elevated_c ?? HEAT_ELEVATED_C}°C in the last 24
													hours.
												</div>
												<div className="mt-4 h-2 w-full rounded-full bg-white/10 overflow-hidden">
													<div className="h-full w-1/3 bg-white/10" />
												</div>
												{temp?.heat_risk?.note && <div className="mt-3 text-xs opacity-60">{temp.heat_risk.note}</div>}
											</div>
										);
									}

									return (
										<>
											<div className="h-[220px]">
												<ResponsiveContainer width="100%" height="100%">
													<LineChart
														data={heatRiskSeries}
														margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
													>
														<CartesianGrid strokeDasharray="3 3" opacity={0.15} />
														<XAxis
															dataKey="t"
															type="number"
															domain={["dataMin", "dataMax"]}
															tickFormatter={formatTime}
															tick={{ fontSize: 12, opacity: 0.8 }}
														/>
														<YAxis
															allowDecimals={false}
															tick={{ fontSize: 12, opacity: 0.8 }}
															label={{ value: "Sensors", angle: -90, position: "insideLeft" }}
														/>
														<Tooltip
															content={
																<SensorDataTooltip
																	labelFormatterMs={formatTime}
																	nameMap={{ elevated: "Elevated count", high: "High count" }}
																/>
															}
															cursor={{
																stroke: "rgba(255,255,255,0.18)",
																strokeDasharray: "4 4",
															}}
														/>
														<Legend />
														<Line
															type="monotone"
															dataKey="elevated"
															name="Elevated"
															dot={false}
															connectNulls
															strokeWidth={2}
															stroke={"#d97706"}
														/>
														<Line
															type="monotone"
															dataKey="high"
															name="High"
															dot={false}
															connectNulls
															strokeWidth={2}
															stroke={"#ef4444"}
														/>
													</LineChart>
												</ResponsiveContainer>
											</div>
											{temp?.heat_risk?.note && <div className="mt-2 text-xs opacity-70">{temp.heat_risk.note}</div>}
										</>
									);
								})()}
							</Card>

							<Card title="Top 5 hotspots (now)">
								<div className="overflow-x-auto">
									<table className="w-full text-left text-sm">
										<thead className="text-xs opacity-70">
											<tr>
												<th className="py-2 pr-3">Location</th>
												<th className="py-2 pr-3">Current</th>
												<th className="py-2 pr-3">Risk</th>
												<th className="py-2 pr-3">Exceed</th>
												<th className="py-2 pr-3">Trend</th>
												<th className="py-2 pr-3">Last update</th>
											</tr>
										</thead>
										<tbody>
											{(temp?.top_hotspots_now ?? []).map((h) => (
												<tr key={h.sensor_id} className="border-t border-white/10">
													<td className="py-2 pr-3">{h.location_name}</td>
													<td className="py-2 pr-3">
														{h.current_c == null ? "—" : `${h.current_c.toFixed(1)}°C`}
													</td>
													<td className="py-2 pr-3">
														<Badge label={h.risk_label} />
													</td>
													<td className="py-2 pr-3">
														{h.threshold_exceedance_c == null ? "—" : `+${h.threshold_exceedance_c.toFixed(1)}°C`}
													</td>
													<td className="py-2 pr-3">
														<Badge label={h.trend_24h} />
													</td>
													<td className="py-2 pr-3 text-xs opacity-80">{fmtISOToLocal(h.last_update_utc)}</td>
												</tr>
											))}
											{!temp && (
												<tr>
													<td className="py-3 text-sm opacity-70" colSpan={6}>
														Loading…
													</td>
												</tr>
											)}
										</tbody>
									</table>
								</div>
							</Card>
						</div>

						{/* Sound */}
						<div className="flex flex-col gap-4">
							<Card title="Sound (24h trend)">
								<div className="flex flex-wrap items-center gap-3 text-xs opacity-80 mb-2">
									<span>
										City 24h: <Badge label={noise?.trend.city_24h ?? "Unknown"} />
									</span>
									<span>
										Violations: <span className="font-semibold">{noiseViolationCount}</span>
									</span>
									<span>
										Threshold now: {noise?.thresholds.current_db ?? 0} dBA
									</span>
								</div>

								<div className="h-[320px]">
									<ResponsiveContainer width="100%" height="100%">
										<LineChart
											data={noiseSeries}
											margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
										>
											<CartesianGrid strokeDasharray="3 3" opacity={0.15} />
											<XAxis
												dataKey="t"
												type="number"
												domain={["dataMin", "dataMax"]}
												tickFormatter={formatTime}
												tick={{ fontSize: 12, opacity: 0.8 }}
											/>
											<YAxis
												tick={{ fontSize: 12, opacity: 0.8 }}
												label={{ value: "dB", angle: -90, position: "insideLeft" }}
											/>
											<Tooltip
												content={
													<SensorDataTooltip
														labelFormatterMs={formatTime}
														nameMap={{ average_db: "Avg dB" }}
													/>
												}
												cursor={{
													stroke: "rgba(255,255,255,0.18)",
													strokeDasharray: "4 4",
												}}
											/>
											<Legend />
											<Line
												type="monotone"
												dataKey="average_db"
												name="Avg dB"
												dot={false}
												connectNulls={false}
												strokeWidth={2}
												stroke={"#335BCA"}
											/>
										</LineChart>
									</ResponsiveContainer>
								</div>
							</Card>

							<Card title="Top 5 noise hotspots (now)">
								<div className="overflow-x-auto">
									<table className="w-full text-left text-sm">
										<thead className="text-xs opacity-70">
											<tr>
												<th className="py-2 pr-3">Location</th>
												<th className="py-2 pr-3">Current</th>
												<th className="py-2 pr-3">Violation</th>
												<th className="py-2 pr-3">Exceed</th>
												<th className="py-2 pr-3">Trend</th>
												<th className="py-2 pr-3">Last update</th>
											</tr>
										</thead>
										<tbody>
											{(noise?.top_hotspots_now ?? []).map((h) => (
												<tr key={h.sensor_id} className="border-t border-white/10">
													<td className="py-2 pr-3">{h.location_name}</td>
													<td className="py-2 pr-3">
														{h.current_avg_db == null ? "—" : `${h.current_avg_db.toFixed(1)} dBA`}
													</td>
													<td className="py-2 pr-3">
														<Badge label={h.is_violation_proxy ? "High" : "Normal"} />
													</td>
													<td className="py-2 pr-3">
														{h.threshold_exceedance_db == null ? "—" : `+${h.threshold_exceedance_db.toFixed(1)} dB`}
													</td>
													<td className="py-2 pr-3">
														<Badge label={h.trend_24h} />
													</td>
													<td className="py-2 pr-3 text-xs opacity-80">{fmtISOToLocal(h.last_update_utc)}</td>
												</tr>
											))}
											{!noise && (
												<tr>
													<td className="py-3 text-sm opacity-70" colSpan={6}>
														Loading…
													</td>
												</tr>
											)}
										</tbody>
									</table>
								</div>
							</Card>

							<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
								<div className="text-sm font-semibold mb-2">Noise violations</div>
								<div className="space-y-2 text-sm">
									{(noise?.noise_violations ?? []).length === 0 && <div className="opacity-80">None right now.</div>}
									{(noise?.noise_violations ?? []).slice(0, 10).map((v) => (
										<div
											key={`v-${v.sensor_id}`}
											className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/10 p-3"
										>
											<div className="font-medium">{v.location_name}</div>
											<div className="opacity-80">
												{v.current_avg_db?.toFixed(1)} dBA (thr {v.threshold_db} dBA)
											</div>
											<div className="text-xs opacity-70">{fmtISOToLocal(v.last_update_utc)}</div>
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</Sidebar>
	);
}
