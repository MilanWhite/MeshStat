import type { TooltipProps } from "recharts";
import type {
	ValueType,
	NameType,
} from "recharts/types/component/DefaultTooltipContent";

type CustomTooltipExtra = {
	unit?: string;
	labelFormatterMs: (ms: number) => string;
	nameMap?: Record<string, string>;
};

type TooltipItem = {
	name?: NameType;
	value?: ValueType;
	dataKey?: string | number;
	color?: string;
};

type SensorDataTooltipProps = TooltipProps<ValueType, NameType> &
	CustomTooltipExtra & {
		payload?: TooltipItem[];
		label?: string | number | null;
	};

export function SensorDataTooltip(props: SensorDataTooltipProps) {
	const { active, payload, label, labelFormatterMs, nameMap } = props;

	if (!active || !payload?.length) return null;

	return (
		<div className="rounded-xl border border-white/10 bg-zinc-950/90 px-3 py-2 shadow-lg">
			<div className="text-xs text-white/70">
				{labelFormatterMs(Number(label))}
			</div>

			<div className="mt-1 space-y-1">
				{payload.map((p) => {
					const key = String(p.dataKey ?? p.name ?? "");
					const displayName =
						(nameMap && nameMap[key]) || String(p.name ?? key);

					const v = p.value;
					const text =
						v == null || Number.isNaN(Number(v))
							? "—"
							: Number(v).toFixed(2);

					return (
						<div
							key={key}
							className="flex items-center justify-between gap-6 text-sm"
						>
							<div className="flex items-center gap-2 text-white/85">
								{/* color swatch */}
								<span
									className="inline-block h-2.5 w-2.5 rounded-sm"
									style={{ background: p.color as string }}
								/>
								<span>{displayName}</span>
							</div>
							<div className="font-mono tabular-nums text-white/90">
								{text}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
