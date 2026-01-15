import { useEffect, useMemo, useState } from "react";
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
import { SensorDataTooltip } from "./SensorDataTooltip/SensorDataTooltip";

type SensorInfo = {
	sensor_id: number;
	location_name?: string | null;
	lat?: number | null;
	lon?: number | null;
};

type SensorsResponse = { count: number; rows: SensorInfo[] };

type SeriesRowApi = {
	ts_utc: string;
	created_at?: string;
	average_db?: number | null;
	max_db?: number | null;
	celsius?: number | null;
};

type SeriesResponse = {
	sensor_id: number;
	start: string;
	end: string;
	time_column: "ts_utc" | "created_at";
	count: number;
	rows: SeriesRowApi[];
};

type Props = {
	sensorsEndpoint?: string; // default "/sensors"
	seriesEndpoint?: string; // default "/sensor-data/series"
};

type ChartPoint = {
	t: number; // unix ms
	average_db: number | null;
	max_db: number | null;
	celsius: number | null;
};

type BucketKey = "1m" | "1h" | "1w" | "1mo";

const BUCKETS: { key: BucketKey; label: string; ms: number }[] = [
	{ key: "1m", label: "1 minute", ms: 60_000 },
	{ key: "1h", label: "1 hour", ms: 60 * 60_000 },
	{ key: "1w", label: "1 week", ms: 7 * 24 * 60 * 60_000 },
	// Deterministic month bucket width (30 days)
	{ key: "1mo", label: "1 month", ms: 30 * 24 * 60 * 60_000 },
];

function bucketMs(key: BucketKey) {
	return BUCKETS.find((b) => b.key === key)!.ms;
}

function aggregateByBucket(
	points: ChartPoint[],
	bucketSizeMs: number
): ChartPoint[] {
	if (points.length === 0) return [];

	const map = new Map<
		number,
		{
			t0: number;
			sumAvg: number;
			nAvg: number;
			sumTemp: number;
			nTemp: number;
			sumMax: number;
			nMax: number;
		}
	>();

	for (const p of points) {
		const t0 = Math.floor(p.t / bucketSizeMs) * bucketSizeMs;

		let acc = map.get(t0);
		if (!acc) {
			acc = {
				t0,
				sumAvg: 0,
				nAvg: 0,
				sumTemp: 0,
				nTemp: 0,
				sumMax: 0,
				nMax: 0,
			};
			map.set(t0, acc);
		}

		if (typeof p.average_db === "number") {
			acc.sumAvg += p.average_db;
			acc.nAvg += 1;
		}

		if (typeof p.celsius === "number") {
			acc.sumTemp += p.celsius;
			acc.nTemp += 1;
		}

		// Per your request: average over the period (not "max of max")
		if (typeof p.max_db === "number") {
			acc.sumMax += p.max_db;
			acc.nMax += 1;
		}
	}

	return Array.from(map.values())
		.sort((a, b) => a.t0 - b.t0)
		.map((acc) => ({
			t: acc.t0,
			average_db: acc.nAvg ? acc.sumAvg / acc.nAvg : null,
			max_db: acc.nMax ? acc.sumMax / acc.nMax : null,
			celsius: acc.nTemp ? acc.sumTemp / acc.nTemp : null,
		}));
}

function toDatetimeLocalValue(d: Date) {
	const pad = (n: number) => String(n).padStart(2, "0");
	const yyyy = d.getFullYear();
	const mm = pad(d.getMonth() + 1);
	const dd = pad(d.getDate());
	const hh = pad(d.getHours());
	const min = pad(d.getMinutes());
	return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function formatTime(ms: number) {
	return new Intl.DateTimeFormat(undefined, {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(ms));
}

export default function SensorDataCharts({
	sensorsEndpoint = "http://127.0.0.1:8000/sensors",
	seriesEndpoint = "http://127.0.0.1:8000/sensor-data/series",
}: Props) {
	const [sensors, setSensors] = useState<SensorInfo[]>([]);
	const [sensorId, setSensorId] = useState<number | null>(null);

	const [rangeStart, setRangeStart] = useState<string>(() =>
		toDatetimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1000))
	);
	const [rangeEnd, setRangeEnd] = useState<string>(() =>
		toDatetimeLocalValue(new Date())
	);

	const [bucket, setBucket] = useState<BucketKey>("1m");

	const [loadingSensors, setLoadingSensors] = useState(false);
	const [loadingSeries, setLoadingSeries] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	// raw points from API
	const [rawSeries, setRawSeries] = useState<ChartPoint[]>([]);

	// aggregated points for charts
	const series = useMemo(() => {
		const ms = bucketMs(bucket);
		return aggregateByBucket(rawSeries, ms);
	}, [rawSeries, bucket]);

	// Load sensors list
	useEffect(() => {
		let cancelled = false;
		(async () => {
			setErr(null);
			setLoadingSensors(true);
			try {
				const res = await fetch(sensorsEndpoint);
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
	}, [sensorsEndpoint]);

	const selectedSensorLabel = useMemo(() => {
		const s = sensors.find((x) => x.sensor_id === sensorId);
		if (!s) return sensorId ? `Sensor ${sensorId}` : "No sensor";
		return s.location_name
			? `Sensor ${s.sensor_id} — ${s.location_name}`
			: `Sensor ${s.sensor_id}`;
	}, [sensors, sensorId]);

	async function loadSeries() {
		if (sensorId == null) return;
		setErr(null);
		setLoadingSeries(true);

		try {
			const startISO = new Date(rangeStart).toISOString();
			const endISO = new Date(rangeEnd).toISOString();

			// IMPORTANT: seriesEndpoint is absolute already; don't combine with window.location.origin
			const url = new URL(seriesEndpoint);
			url.searchParams.set("sensor_id", String(sensorId));
			url.searchParams.set("start", startISO);
			url.searchParams.set("end", endISO);
			url.searchParams.set("time_column", "ts_utc");

			const res = await fetch(url.toString());
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(
					`Series fetch failed: ${res.status}${
						text ? `\n${text.slice(0, 200)}` : ""
					}`
				);
			}

			const json = (await res.json()) as SeriesResponse;

			const points: ChartPoint[] = (json.rows ?? []).map((r) => ({
				t: Date.parse(r.ts_utc),
				average_db:
					typeof r.average_db === "number" ? r.average_db : null,
				max_db: typeof r.max_db === "number" ? r.max_db : null,
				celsius: typeof r.celsius === "number" ? r.celsius : null,
			}));

			points.sort((a, b) => a.t - b.t);
			setRawSeries(points);
		} catch (e: any) {
			setErr(e?.message ?? "Failed to load series");
			setRawSeries([]);
		} finally {
			setLoadingSeries(false);
		}
	}

	function setPast24h() {
		const end = new Date();
		const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
		setRangeEnd(toDatetimeLocalValue(end));
		setRangeStart(toDatetimeLocalValue(start));
	}

	// Auto-load when sensor changes
	useEffect(() => {
		if (sensorId == null) return;
		loadSeries();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sensorId]);

	return (
		<div className="w-full h-full flex flex-col gap-4">
			{/* Controls */}
			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
				<select
					value={sensorId ?? ""}
					onChange={(e) => setSensorId(Number(e.target.value))}
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
					<label className="text-xs opacity-80">Timeframe</label>
					<select
						value={bucket}
						onChange={(e) => setBucket(e.target.value as BucketKey)}
						className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
					>
						{BUCKETS.map((b) => (
							<option
								key={b.key}
								value={b.key}
								className="bg-zinc-700"
							>
								{b.label}
							</option>
						))}
					</select>
				</div>

				<div className="flex items-center gap-2">
					<label className="text-xs opacity-80">Start</label>
					<input
						type="datetime-local"
						value={rangeStart}
						onChange={(e) => setRangeStart(e.target.value)}
						className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm [color-scheme:dark]"
					/>
				</div>

				<div className="flex items-center gap-2">
					<label className="text-xs opacity-80">End</label>
					<input
						type="datetime-local"
						value={rangeEnd}
						onChange={(e) => setRangeEnd(e.target.value)}
						className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm [color-scheme:dark]"
					/>
				</div>

				<button
					onClick={setPast24h}
					className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm"
					type="button"
				>
					Past 24h
				</button>

				<button
					onClick={loadSeries}
					className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm"
					type="button"
					disabled={loadingSeries || sensorId == null}
				>
					Load
				</button>

				<div className="ml-auto flex items-center gap-3">
					<div className="text-xs opacity-80">
						{selectedSensorLabel}
					</div>
					{loadingSeries && (
						<div className="text-xs opacity-80">Loading…</div>
					)}
				</div>
			</div>

			{err && (
				<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
					{err}
				</div>
			)}

			{/* Noise chart */}
			<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
				<div className="text-sm font-semibold mb-2">Sound</div>
				<div className="h-[320px]">
					<ResponsiveContainer
						width="100%"
						height="100%"
						className="text-red-100"
					>
						<LineChart
							data={series}
							margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
						>
							<CartesianGrid
								strokeDasharray="3 3"
								opacity={0.15}
							/>
							<XAxis
								dataKey="t"
								type="number"
								domain={["dataMin", "dataMax"]}
								tickFormatter={formatTime}
								tick={{ fontSize: 12, opacity: 0.8 }}
							/>
							<YAxis
								tick={{ fontSize: 12, opacity: 0.8 }}
								label={{
									value: "dB",
									angle: -90,
									position: "insideLeft",
								}}
							/>
							<Tooltip
								content={
									<SensorDataTooltip
										labelFormatterMs={formatTime}
										nameMap={{
											average_db: "Avg dB",
											max_db: "Max dB",
										}}
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
							<Line
								type="monotone"
								dataKey="max_db"
								name="Max dB"
								dot={false}
								connectNulls={false}
								strokeWidth={2}
								opacity={0.7}
							/>
						</LineChart>
					</ResponsiveContainer>
				</div>
			</div>

			{/* Temperature chart */}
			<div className="rounded-2xl border border-white/10 bg-white/5 p-4">
				<div className="text-sm font-semibold mb-2">Temperature</div>
				<div className="h-[320px]">
					<ResponsiveContainer width="100%" height="100%">
						<LineChart
							data={series}
							margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
						>
							<CartesianGrid
								strokeDasharray="3 3"
								opacity={0.15}
							/>
							<XAxis
								dataKey="t"
								type="number"
								domain={["dataMin", "dataMax"]}
								tickFormatter={formatTime}
								tick={{ fontSize: 12, opacity: 0.8 }}
							/>
							<YAxis
								tick={{ fontSize: 12, opacity: 0.8 }}
								label={{
									value: "°C",
									angle: -90,
									position: "insideLeft",
								}}
							/>

							<Tooltip
								content={
									<SensorDataTooltip
										labelFormatterMs={formatTime}
										nameMap={{
											celsius: "Temperature (°C)",
										}}
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
			</div>
		</div>
	);
}
