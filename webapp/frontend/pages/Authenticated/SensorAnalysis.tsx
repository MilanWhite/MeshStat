// src/pages/AITools/SensorAnalysis.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "../../components/Sidebar";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

type SensorInfo = {
	sensor_id: number;
	location_name?: string | null;
	lat?: number | null;
	lon?: number | null;
};

type SensorsResponse = { count: number; rows: SensorInfo[] };

type ChatMsg = {
	id: string;
	role: "user" | "MeshStat Assistant";
	content: string;
	createdAt: number;
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

function Badge({ label }: { label: string }) {
	const tone =
		label === "MeshStat Assistant"
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

function uid() {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function TypingDots() {
	// Staggered bounce via inline delay (no Tailwind config needed)
	const dotBase =
		"inline-block h-2 w-2 rounded-full bg-white/70 animate-bounce";
	return (
		<div className="flex items-center gap-2">
			<span className={dotBase} style={{ animationDelay: "0ms" }} />
			<span className={dotBase} style={{ animationDelay: "150ms" }} />
			<span className={dotBase} style={{ animationDelay: "300ms" }} />
		</div>
	);
}

export default function SensorAnalysis() {
	const [sensors, setSensors] = useState<SensorInfo[]>([]);
	const [sensorId, setSensorId] = useState<number | null>(null);

	const [loadingSensors, setLoadingSensors] = useState(false);
	const [sending, setSending] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const [messages, setMessages] = useState<ChatMsg[]>([
		{
			id: uid(),
			role: "MeshStat Assistant",
			content:
				"Ask about trends, anomalies, or summaries for your sensor data.",
			createdAt: Date.now(),
		},
	]);

	const [input, setInput] = useState("");
	const [contextStart, setContextStart] = useState<string>(() =>
		toDatetimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1000))
	);
	const [contextEnd, setContextEnd] = useState<string>(() =>
		toDatetimeLocalValue(new Date())
	);

	const bottomRef = useRef<HTMLDivElement | null>(null);

	const selectedSensorLabel = useMemo(() => {
		const s = sensors.find((x) => x.sensor_id === sensorId);
		if (!s) return sensorId ? `Sensor ${sensorId}` : "No sensor";
		return s.location_name
			? `Sensor ${s.sensor_id} — ${s.location_name}`
			: `Sensor ${s.sensor_id}`;
	}, [sensors, sensorId]);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages.length, sending]);

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

	async function send() {
		const text = input.trim();
		if (!text || sending) return;

		setErr(null);
		setSending(true);

		const userMsg: ChatMsg = {
			id: uid(),
			role: "user",
			content: text,
			createdAt: Date.now(),
		};
		setMessages((m) => [...m, userMsg]);
		setInput("");

		try {
			const res = await fetch(`${API_BASE}/ai/sensor-analysis`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					message: text,
					sensor_id: sensorId,
					start: new Date(contextStart).toISOString(),
					end: new Date(contextEnd).toISOString(),
				}),
			});

			if (!res.ok) {
				const t = await res.text().catch(() => "");
				throw new Error(
					`AI request failed: ${res.status}${
						t ? `\n${t.slice(0, 200)}` : ""
					}`
				);
			}

			const json = (await res.json()) as { reply?: string };
			const reply = (json.reply ?? "").trim() || "No reply returned.";

			const assistant: ChatMsg = {
				id: uid(),
				role: "MeshStat Assistant",
				content: reply,
				createdAt: Date.now(),
			};
			setMessages((m) => [...m, assistant]);
		} catch (e: any) {
			setErr(e?.message ?? "Failed to send");
			const assistant: ChatMsg = {
				id: uid(),
				role: "MeshStat Assistant",
				content:
					"Request failed. Wire this page to your backend route and response shape.",
				createdAt: Date.now(),
			};
			setMessages((m) => [...m, assistant]);
		} finally {
			setSending(false);
		}
	}

	function clearChat() {
		setErr(null);
		setMessages([
			{
				id: uid(),
				role: "MeshStat Assistant",
				content:
					"Ask about trends, anomalies, or summaries for your sensor data.",
				createdAt: Date.now(),
			},
		]);
	}

	function setPast24h() {
		const end = new Date();
		const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
		setContextEnd(toDatetimeLocalValue(end));
		setContextStart(toDatetimeLocalValue(start));
	}

	return (
		<Sidebar>
			<div className="w-full h-full flex flex-col gap-3">
				<h1 className="text-4xl font-bold tracking-tight text-heading md:text-5xl lg:text-4xl">
					Sensor Analysis
				</h1>
				<p className="mb-4 text-lg text-body">
					Chat with an AI analyst over sensor data.
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
							<label className="text-xs opacity-80">Start</label>
							<input
								type="datetime-local"
								value={contextStart}
								onChange={(e) =>
									setContextStart(e.target.value)
								}
								className="rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm [color-scheme:dark]"
							/>
						</div>

						<div className="flex items-center gap-2">
							<label className="text-xs opacity-80">End</label>
							<input
								type="datetime-local"
								value={contextEnd}
								onChange={(e) => setContextEnd(e.target.value)}
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
							onClick={clearChat}
							className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm"
							type="button"
						>
							Clear
						</button>

						<div className="ml-auto flex items-center gap-3">
							<div className="text-xs opacity-80">
								{selectedSensorLabel}
							</div>
							{sending && (
								<div className="text-xs opacity-80">
									Sending…
								</div>
							)}
						</div>
					</div>

					{err && (
						<div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
							{err}
						</div>
					)}

					<Card title="Chat">
						<div className="flex flex-col gap-3">
							<div
								className="h-[420px] overflow-y-auto rounded-xl border border-white/10 bg-black/10 p-3"
								aria-busy={sending}
							>
								<div className="sr-only" aria-live="polite">
									{sending ? "Assistant is typing." : ""}
								</div>

								<div className="space-y-3">
									{messages.map((m) => (
										<div
											key={m.id}
											className="flex flex-col gap-1"
										>
											<div className="flex items-center gap-2">
												<Badge label={m.role} />
												<div className="text-xs opacity-60">
													{new Date(
														m.createdAt
													).toLocaleString()}
												</div>
											</div>
											<div className="whitespace-pre-wrap rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
												{m.content}
											</div>
										</div>
									))}

									{/* Typing indicator (not stored in messages) */}
									{sending && (
										<div className="flex flex-col gap-1">
											<div className="flex items-center gap-2">
												<Badge label="MeshStat Assistant" />
												<div className="text-xs opacity-60">
													typing…
												</div>
											</div>
											<div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
												<TypingDots />
											</div>
										</div>
									)}

									<div ref={bottomRef} />
								</div>
							</div>

							<div className="flex items-end gap-2">
								<textarea
									value={input}
									onChange={(e) => setInput(e.target.value)}
									rows={3}
									placeholder="Type a question…"
									className="w-full resize-none rounded-xl border border-white/10 bg-black/20 p-3 text-sm outline-none"
									disabled={sending}
									onKeyDown={(e) => {
										if (
											e.key === "Enter" &&
											(e.ctrlKey || e.metaKey)
										) {
											e.preventDefault();
											send();
										}
									}}
								/>
								<button
									onClick={send}
									className="rounded-lg bg-white/10 hover:bg-white/15 px-4 py-3 text-sm"
									type="button"
									disabled={sending || !input.trim()}
									title="Send (Ctrl/Cmd+Enter)"
								>
									Send
								</button>
							</div>

							<div className="text-xs opacity-70">
								Send shortcut: Ctrl/Cmd+Enter.
							</div>
						</div>
					</Card>
				</div>
			</div>
		</Sidebar>
	);
}
