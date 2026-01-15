// Drop-in React + TypeScript component for MapLibre heatmap playback (range) + realtime (latest)

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DataDrivenPropertyValueSpecification } from "maplibre-gl";
import maplibregl, { Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/** ---------- Types ---------- */

type MetricKey = "average_db" | "celsius";

type Metric = {
	key: MetricKey;
	label: string;
	unit: string;
	min?: number;
	max?: number;
};

type Props = {
	styleUrl?: string;

	supabaseUrl?: string;
	supabaseAnonKey?: string;
	tableName?: string;

	latestEndpoint: string;
	rangeEndpoint: string;

	initialView?: { center: [number, number]; zoom: number };
};

/** ---------- Metric definitions ---------- */

const METRICS: Metric[] = [
	{
		key: "average_db",
		label: "Noise (Avg dB)",
		unit: "dB",
		min: 40,
		max: 95,
	},
	{
		key: "celsius",
		label: "Temperature",
		unit: "°C",
		min: -25,
		max: 30,
	},
];

/** ---------- Color ramp ---------- */
const COLOR_STOPS = [
	{ t: 0.0, c: "rgba(0,0,0,0)" },
	{ t: 0.15, c: "rgba(59,130,246,0.55)" },
	{ t: 0.35, c: "rgba(34,197,94,0.60)" },
	{ t: 0.55, c: "rgba(234,179,8,0.70)" },
	{ t: 0.75, c: "rgba(249,115,22,0.80)" },
	{ t: 1.0, c: "rgba(239,68,68,0.90)" },
];

/** ---------- Helpers ---------- */

const ET_TZ = "America/Toronto"; // ET (EST/EDT automatically)

function toDatetimeLocalValue(d: Date) {
	const pad = (n: number) => String(n).padStart(2, "0");
	const yyyy = d.getFullYear();
	const mm = pad(d.getMonth() + 1);
	const dd = pad(d.getDate());
	const hh = pad(d.getHours());
	const min = pad(d.getMinutes());
	return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

// Display UTC ISO strings in ET for UI/popup/labels
function formatIsoToET(iso: string) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat(undefined, {
		timeZone: ET_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		timeZoneName: "short", // shows EST/EDT
	}).format(d);
}

function clamp01(x: number) {
	return Math.max(0, Math.min(1, x));
}

type SensorRowApi = {
	id: number;
	sensor_id: number;
	created_at: string;
	lat: number;
	lon: number;
	location_name?: string | null;
	ts_utc: string;
	max_db?: number | null;
	average_db?: number | null;
	celsius?: number | null;
};

type SensorRow = {
	sensor_id: string;
	lat: number;
	lon: number;
	ts_utc: string;
	location_name?: string | null;
	max_db?: number | null;
	average_db?: number | null;
	celsius?: number | null;
};

type Frame = { ts: string; rows: SensorRow[] };

function getMetricValue(row: SensorRow, metric: Metric): number | null {
	const v = row[metric.key];
	if (typeof v !== "number" || Number.isNaN(v)) return null;
	return v;
}

function computeMinMax(
	rows: SensorRow[],
	metric: Metric
): { min: number; max: number } {
	if (typeof metric.min === "number" && typeof metric.max === "number") {
		return { min: metric.min, max: metric.max };
	}
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const r of rows) {
		const v = getMetricValue(r, metric);
		if (v === null) continue;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
		return { min: 0, max: 1 };
	}
	return { min, max };
}

function toFeatureCollection(
	rows: SensorRow[],
	metric: Metric,
	min: number,
	max: number
) {
	return {
		type: "FeatureCollection",
		features: rows
			.map((r) => {
				const v = getMetricValue(r, metric);
				if (v === null) return null;
				if (typeof r.lat !== "number" || typeof r.lon !== "number")
					return null;

				const w = clamp01((v - min) / (max - min));
				return {
					type: "Feature",
					geometry: { type: "Point", coordinates: [r.lon, r.lat] },
					properties: {
						sensor_id: r.sensor_id,
						ts_utc: r.ts_utc, // keep UTC in data
						value: v,
						w,
					},
				};
			})
			.filter(Boolean),
	} as const;
}

function buildValueColorExpression(min: number, max: number) {
	const expr: any[] = ["interpolate", ["linear"], ["get", "value"]];
	for (const stop of COLOR_STOPS) {
		const v = min + stop.t * (max - min);
		const color = stop.t === 0 ? "rgba(59,130,246,0.70)" : stop.c;
		expr.push(v, color);
	}
	return expr;
}

/** ---------- Backend fetchers ---------- */

type LatestResponse = {
	count: number;
	rows: SensorRowApi[];
};

type RangeResponse = {
	start: string;
	end: string;
	time_column: string;
	count: number;
	by_sensor: Record<string, SensorRowApi[]>;
};

function mapApiRow(r: SensorRowApi): SensorRow {
	return {
		sensor_id: String(r.sensor_id),
		lat: r.lat,
		lon: r.lon,
		ts_utc: r.ts_utc,
		location_name: r.location_name ?? null,
		max_db: r.max_db ?? null,
		average_db: r.average_db ?? null,
		celsius: r.celsius ?? null,
	};
}

function rangeResponseToFrames(
	resp: RangeResponse,
	carryForward = true
): Frame[] {
	const series: Record<string, SensorRow[]> = {};
	const allTimes = new Set<string>();

	for (const [sid, arr] of Object.entries(resp.by_sensor ?? {})) {
		const rows = (arr ?? [])
			.map(mapApiRow)
			.sort((a, b) => Date.parse(a.ts_utc) - Date.parse(b.ts_utc));
		series[sid] = rows;
		for (const r of rows) allTimes.add(r.ts_utc);
	}

	const times = Array.from(allTimes).sort(
		(a, b) => Date.parse(a) - Date.parse(b)
	);

	if (!carryForward) {
		const byTs = new Map<string, SensorRow[]>();
		for (const rows of Object.values(series)) {
			for (const r of rows) {
				const list = byTs.get(r.ts_utc) ?? [];
				list.push(r);
				byTs.set(r.ts_utc, list);
			}
		}
		return times.map((ts) => ({ ts, rows: byTs.get(ts) ?? [] }));
	}

	const sensorIds = Object.keys(series);
	const idx: Record<string, number> = {};
	const last: Record<string, SensorRow | null> = {};
	for (const sid of sensorIds) {
		idx[sid] = 0;
		last[sid] = null;
	}

	const frames: Frame[] = [];
	for (const ts of times) {
		const t = Date.parse(ts);
		const frameRows: SensorRow[] = [];
		for (const sid of sensorIds) {
			const rows = series[sid];
			while (
				idx[sid] < rows.length &&
				Date.parse(rows[idx[sid]].ts_utc) <= t
			) {
				last[sid] = rows[idx[sid]];
				idx[sid] += 1;
			}
			if (last[sid]) frameRows.push(last[sid]!);
		}
		frames.push({ ts, rows: frameRows });
	}

	return frames;
}

const range = (min: number, max: number): number[] =>
	[...Array(max - min).keys()].map((i) => i + min);

async function fetchLatest(
	latestEndpoint: string,
	metricKey?: string
): Promise<SensorRow[]> {
	const url = new URL(latestEndpoint, window.location.origin);
	// if (metricKey) url.searchParams.set("metric", metricKey);

	const res = await fetch(url.toString());
	if (!res.ok) throw new Error(`Latest fetch failed: ${res.status}`);

	const json = (await res.json()) as LatestResponse;
	return (json.rows ?? []).map(mapApiRow);
}

async function fetchRangeFrames(
	rangeEndpoint: string,
	metricKey: string | undefined,
	startISO: string,
	endISO: string
): Promise<Frame[]> {
	const url = new URL(rangeEndpoint, window.location.origin);
	url.searchParams.set("start", startISO);
	url.searchParams.set("end", endISO);
	if (metricKey) url.searchParams.set("metric", metricKey);

	// remove this block if you want "all sensors" from backend
	url.searchParams.delete("sensor_ids");
	for (const id of range(1, 5))
		url.searchParams.append("sensor_ids", String(id));

	const res = await fetch(url.toString());
	if (!res.ok) throw new Error(`Range fetch failed: ${res.status}`);

	const json = (await res.json()) as RangeResponse;
	return rangeResponseToFrames(json, true);
}

/** ---------- Component ---------- */

export default function Heatmap({
	styleUrl = "https://demotiles.maplibre.org/style.json",
	supabaseUrl,
	supabaseAnonKey,
	tableName = "sensor_data",
	latestEndpoint,
	rangeEndpoint,
	initialView = { center: [-76.485954, 44.231172], zoom: 13 },
}: Props) {
	const mapContainerRef = useRef<HTMLDivElement | null>(null);
	const mapRef = useRef<MLMap | null>(null);

	const [mode, setMode] = useState<"latest" | "range">("latest");
	const [metricKey, setMetricKey] = useState<MetricKey>("average_db");
	const metric = useMemo(
		() => METRICS.find((m) => m.key === metricKey)!,
		[metricKey]
	);

	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const latestBySensorRef = useRef<Map<string, SensorRow>>(new Map());

	const [frames, setFrames] = useState<Frame[]>([]);
	const [frameIndex, setFrameIndex] = useState(0);

	// IMPORTANT: datetime-local inputs should be LOCAL time, not UTC slices
	const [rangeStart, setRangeStart] = useState<string>(() =>
		toDatetimeLocalValue(new Date(Date.now() - 60 * 60 * 1000))
	);
	const [rangeEnd, setRangeEnd] = useState<string>(() =>
		toDatetimeLocalValue(new Date())
	);

	const [scale, setScale] = useState<{ min: number; max: number }>({
		min: metric.min ?? 0,
		max: metric.max ?? 1,
	});

	const pendingGeoJsonRef = useRef<any | null>(null);

	const metricRef = useRef(metric);
	useEffect(() => {
		metricRef.current = metric;
	}, [metric]);

	const scaleRef = useRef(scale);
	useEffect(() => {
		scaleRef.current = scale;
	}, [scale.min, scale.max]);

	const supabaseRef = useRef<SupabaseClient | null>(null);

	const didAutoLoadRangeRef = useRef(false);

	/** Initialize MapLibre once */
	useEffect(() => {
		if (!mapContainerRef.current) return;
		if (mapRef.current) return;

		const map = new maplibregl.Map({
			container: mapContainerRef.current!,
			style: "https://api.maptiler.com/maps/basic-v2-dark/style.json?key=wpIC7wyBfkCmBLDxyN8K",
			center: initialView.center,
			zoom: initialView.zoom,
		});

		map.addControl(
			new maplibregl.NavigationControl({ visualizePitch: true }),
			"top-right"
		);

		map.on("load", () => {
			map.addSource("meshstat", {
				type: "geojson",
				// if we fetched before map loaded, use that data immediately
				data:
					pendingGeoJsonRef.current ??
					({ type: "FeatureCollection", features: [] } as any),
			});

			map.addLayer({
				id: "meshstat-glow",
				type: "circle",
				source: "meshstat",
				paint: {
					"circle-color": buildValueColorExpression(
						scaleRef.current.min,
						scaleRef.current.max
					) as DataDrivenPropertyValueSpecification<string>,
					"circle-opacity": 0.45,
					"circle-blur": 0.9,
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						10,
						["+", 18, ["*", 28, ["coalesce", ["get", "w"], 0]]],
						14,
						["+", 30, ["*", 45, ["coalesce", ["get", "w"], 0]]],
						17,
						["+", 42, ["*", 65, ["coalesce", ["get", "w"], 0]]],
					],
				},
			});

			map.addLayer({
				id: "meshstat-dot",
				type: "circle",
				source: "meshstat",
				paint: {
					"circle-color": buildValueColorExpression(
						scaleRef.current.min,
						scaleRef.current.max
					) as DataDrivenPropertyValueSpecification<string>,
					"circle-opacity": 0.95,
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						10,
						3,
						14,
						5,
						17,
						7,
					],
					"circle-stroke-color": "rgba(255,255,255,0.75)",
					"circle-stroke-width": 1,
				},
			});

			map.addLayer({
				id: "meshstat-circles",
				type: "circle",
				source: "meshstat",
				paint: {
					"circle-radius": [
						"interpolate",
						["linear"],
						["zoom"],
						10,
						18,
						14,
						26,
						17,
						34,
					],
					"circle-opacity": 0,
					"circle-stroke-width": 0,
				},
			});

			const popup = new maplibregl.Popup({
				closeButton: false,
				closeOnClick: false,
				className: "meshstat-popup",
			});

			map.on("mousemove", "meshstat-circles", (e: any) => {
				const f = e.features?.[0];
				if (!f) return;
				const props = f.properties as any;
				const value = Number(props.value);
				const sensorId = String(props.sensor_id ?? "");
				const tsUtc = String(props.ts_utc ?? "");
				const tsEt = formatIsoToET(tsUtc);

				const m = metricRef.current;

				popup
					.setLngLat(e.lngLat)
					.setHTML(
						`<div style="font-family: ui-sans-serif, system-ui; font-size: 12px;">
               <div style="font-weight: 600;">${sensorId}</div>
               <div>${m.label}: <b>${value.toFixed(1)} ${m.unit}</b></div>
               <div style="opacity: 0.75;">${tsEt}</div>
             </div>`
					)
					.addTo(map);
			});

			map.on("mouseleave", "meshstat-circles", () => popup.remove());

			// ensure colors match current scale immediately on first load
			const expr = buildValueColorExpression(
				scaleRef.current.min,
				scaleRef.current.max
			);
			for (const layerId of ["meshstat-glow", "meshstat-dot"]) {
				if (map.getLayer(layerId))
					map.setPaintProperty(layerId, "circle-color", expr);
			}
		});

		mapRef.current = map;

		return () => {
			map.remove();
			mapRef.current = null;
		};
		// init once; do NOT depend on scale/metric or you'll recreate the map
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [styleUrl, initialView.center, initialView.zoom]);

	/** Create Supabase client if provided */
	useEffect(() => {
		if (!supabaseUrl || !supabaseAnonKey) return;
		supabaseRef.current = createClient(supabaseUrl, supabaseAnonKey);
		return () => {
			supabaseRef.current = null;
		};
	}, [supabaseUrl, supabaseAnonKey]);

	function setGeoJson(geojson: any) {
		pendingGeoJsonRef.current = geojson;

		const map = mapRef.current;
		if (!map) return;
		const src = map.getSource("meshstat") as
			| maplibregl.GeoJSONSource
			| undefined;
		if (!src) return;
		src.setData(geojson);
	}

	async function loadLatest() {
		setErr(null);
		setLoading(true);
		try {
			const rows = await fetchLatest(latestEndpoint);
			latestBySensorRef.current.clear();
			for (const r of rows) latestBySensorRef.current.set(r.sensor_id, r);

			const list = Array.from(latestBySensorRef.current.values());
			const mm = computeMinMax(list, metric);
			setScale(mm);
			setGeoJson(toFeatureCollection(list, metric, mm.min, mm.max));
		} catch (e: any) {
			setErr(e?.message ?? "Failed to load latest");
		} finally {
			setLoading(false);
		}
	}

	/** Subscribe to realtime inserts for Latest mode */
	useEffect(() => {
		if (mode !== "latest") return;
		const supa = supabaseRef.current;
		if (!supa) return;

		loadLatest();

		let raf = 0;
		let pending = false;

		const channel = supa
			.channel("meshstat-latest")
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: tableName },
				(payload: any) => {
					const row = payload.new as SensorRow;
					latestBySensorRef.current.set(row.sensor_id, row);

					if (!pending) {
						pending = true;
						cancelAnimationFrame(raf);
						raf = requestAnimationFrame(() => {
							pending = false;
							const list = Array.from(
								latestBySensorRef.current.values()
							);
							const mm = computeMinMax(list, metric);
							setScale(mm);
							setGeoJson(
								toFeatureCollection(
									list,
									metric,
									mm.min,
									mm.max
								)
							);
						});
					}
				}
			)
			.subscribe();

		return () => {
			cancelAnimationFrame(raf);
			supa.removeChannel(channel);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode, metricKey, tableName, latestEndpoint]);

	async function loadRange(params?: { startISO?: string; endISO?: string }) {
		setErr(null);
		setLoading(true);
		try {
			// rangeStart/rangeEnd are local datetime-local strings
			const startISO =
				params?.startISO ?? new Date(rangeStart).toISOString();
			const endISO = params?.endISO ?? new Date(rangeEnd).toISOString();

			const fr = await fetchRangeFrames(
				rangeEndpoint,
				metric.key,
				startISO,
				endISO
			);

			setFrames(fr);
			setFrameIndex(0);

			const allRows = fr.flatMap((f) => f.rows);
			const mm = computeMinMax(allRows, metric);
			setScale(mm);

			if (fr.length > 0) {
				setGeoJson(
					toFeatureCollection(fr[0].rows, metric, mm.min, mm.max)
				);
			} else {
				setGeoJson({ type: "FeatureCollection", features: [] });
			}
		} catch (e: any) {
			setErr(e?.message ?? "Failed to load range");
		} finally {
			setLoading(false);
		}
	}

	function setPast24hAndLoad() {
		const end = new Date();
		const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

		setRangeStart(toDatetimeLocalValue(start));
		setRangeEnd(toDatetimeLocalValue(end));

		void loadRange({
			startISO: start.toISOString(),
			endISO: end.toISOString(),
		});
	}

	useEffect(() => {
		if (mode !== "range") return;
		if (frames.length === 0) return;

		const i = Math.max(0, Math.min(frames.length - 1, frameIndex));
		const frame = frames[i];
		setGeoJson(
			toFeatureCollection(frame.rows, metric, scale.min, scale.max)
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [frameIndex, mode, frames, metricKey]);

	useEffect(() => {
		if (mode === "latest") {
			didAutoLoadRangeRef.current = false;
			if (!supabaseRef.current) loadLatest();
		} else {
			setFrames([]);
			setFrameIndex(0);
			setGeoJson({ type: "FeatureCollection", features: [] });

			if (!didAutoLoadRangeRef.current) {
				didAutoLoadRangeRef.current = true;
				setPast24hAndLoad();
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode, metricKey]);

	useEffect(() => {
		const map = mapRef.current;
		if (!map) return;

		const expr = buildValueColorExpression(scale.min, scale.max);
		for (const layerId of ["meshstat-glow", "meshstat-dot"]) {
			if (map.getLayer(layerId))
				map.setPaintProperty(layerId, "circle-color", expr);
		}
	}, [scale.min, scale.max]);

	const currentFrameTs = useMemo(() => {
		if (mode !== "range" || frames.length === 0) return null;
		const tsUtc =
			frames[Math.max(0, Math.min(frames.length - 1, frameIndex))]?.ts ??
			null;
		return tsUtc ? formatIsoToET(tsUtc) : null;
	}, [mode, frames, frameIndex]);

	return (
		<div className="w-full h-full flex flex-col gap-3">
			<h1 className=" text-4xl font-bold tracking-tight text-heading md:text-5xl lg:text-4xl">
				Heatmap
			</h1>
			<p className="mb-4 text-lg text-body">
				Visualize sensor data as a heatmap. Select between viewing the
				latest readings in real-time or exploring historical data over a
				specified time range.
			</p>

			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
				<div className="inline-flex rounded-lg overflow-hidden border border-white/10">
					<button
						className={`px-3 py-2 text-sm ${
							mode === "latest" ? "bg-white/10" : "bg-transparent"
						} hover:bg-white/10`}
						onClick={() => setMode("latest")}
					>
						Latest
					</button>
					<button
						className={`px-3 py-2 text-sm ${
							mode === "range" ? "bg-white/10" : "bg-transparent"
						} hover:bg-white/10`}
						onClick={() => setMode("range")}
					>
						Range
					</button>
				</div>

				<select
					value={metricKey}
					onChange={(e) => setMetricKey(e.target.value as MetricKey)}
					className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
				>
					{METRICS.map((m) => (
						<option
							key={m.key}
							value={m.key}
							className="bg-zinc-700 "
						>
							{m.label}
						</option>
					))}
				</select>

				{mode === "range" && (
					<div className="flex flex-wrap items-center gap-2">
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
							onClick={setPast24hAndLoad}
							className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm"
							disabled={loading}
							type="button"
						>
							Past 24h
						</button>

						<button
							onClick={() => void loadRange()}
							className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm"
							disabled={loading}
							type="button"
						>
							Load
						</button>
					</div>
				)}

				{mode === "latest" && !supabaseUrl && (
					<button
						onClick={loadLatest}
						className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm"
						disabled={loading}
						type="button"
					>
						Refresh
					</button>
				)}

				<div className="ml-auto flex items-center gap-3">
					<div className="text-xs opacity-80">
						Scale: {scale.min.toFixed(0)}–{scale.max.toFixed(0)}{" "}
						{metric.unit}
					</div>
					{loading && (
						<div className="text-xs opacity-80">Loading…</div>
					)}
				</div>
			</div>

			{err && (
				<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
					{err}
				</div>
			)}

			<div className="relative w-full flex-1 rounded-2xl overflow-hidden border border-white/10">
				<div
					ref={mapContainerRef}
					className="absolute inset-0"
					style={{
						width: "100%",
						height: mode === "latest" ? "70vh" : "60vh",
					}}
				/>

				<div className="absolute left-3 bottom-3 rounded-xl border border-white/10 bg-black/50 backdrop-blur px-3 py-2">
					<div className="text-xs font-semibold mb-2">
						{metric.label}
					</div>
					<div className="flex items-center gap-2">
						<span className="text-[11px] opacity-80">
							{scale.min.toFixed(0)}
						</span>
						<div
							className="h-2 w-44 rounded-full overflow-hidden"
							style={{ background: "rgba(255,255,255,0.08)" }}
						>
							<div
								className="h-full w-full"
								style={{
									background: `linear-gradient(to right,
                    rgba(59,130,246,0.85),
                    rgba(34,197,94,0.85),
                    rgba(234,179,8,0.90),
                    rgba(249,115,22,0.95),
                    rgba(239,68,68,0.95)
                  )`,
								}}
							/>
						</div>
						<span className="text-[11px] opacity-80">
							{scale.max.toFixed(0)} {metric.unit}
						</span>
					</div>
					<div className="text-[11px] opacity-70 mt-1">
						Heatmap = weighted density; circles = exact value
					</div>
				</div>
			</div>

			{mode === "range" && frames.length >= 0 && (
				<div className="rounded-xl border border-white/10 bg-white/5 p-3">
					<div className="flex items-center justify-between gap-3">
						<div className="text-sm">
							Time:{" "}
							<span className="opacity-80">{currentFrameTs}</span>
						</div>
						<div className="text-xs opacity-80">
							Frame {frameIndex + 1} / {frames.length}
						</div>
					</div>

					<input
						type="range"
						min={0}
						max={Math.max(0, frames.length - 1)}
						value={frameIndex}
						onChange={(e) => setFrameIndex(Number(e.target.value))}
						className="w-full mt-3 accent-[#4f39f6]"
					/>
				</div>
			)}
		</div>
	);
}
