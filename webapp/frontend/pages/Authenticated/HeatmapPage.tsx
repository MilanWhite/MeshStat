import Heatmap from "../../components/Heatmap/Heatmap";
import Sidebar from "../../components/Sidebar";

export default function HeatmapPage() {
	return (
		<>
			<Sidebar>
				<Heatmap
					latestEndpoint={import.meta.env.VITE_API_BASE_URL + "/sensor-data/latest"}
					rangeEndpoint={import.meta.env.VITE_API_BASE_URL + "/sensor-data/range"}
					// Optional realtime:
					supabaseUrl={import.meta.env.VITE_SUPABASE_URL}
					supabaseAnonKey={import.meta.env.VITE_SUPABASE_ANON_KEY}
					tableName="sensor_data"
					initialView={{ center: [-76.485954, 44.231172], zoom: 14 }}
				/>
			</Sidebar>
		</>
	);
}
