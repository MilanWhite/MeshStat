import {
	ArrowPathIcon,
	ChevronRightIcon,
	CloudArrowUpIcon,
	Cog6ToothIcon,
	FingerPrintIcon,
	LockClosedIcon,
	ServerIcon,
} from "@heroicons/react/20/solid";
import {
	BoltIcon,
	CalendarDaysIcon,
	UsersIcon,
} from "@heroicons/react/24/outline";

import LandingPage from "../../components/LandingPage";
import Heatmap from "../../components/Heatmap/Heatmap";

export default function GeneralHomePage() {
	return (
		<>
			<LandingPage />
			<div id="general_homepage_heatmap_id" />

			<div className="mt-20 mx-auto h-full max-w-7xl px-6 lg:px-8">
				<div className="h-full pb-20 gap-10 lg:grid-cols-2">
					<Heatmap
						latestEndpoint={import.meta.env.VITE_API_BASE_URL + "/sensor-data/latest"}
						rangeEndpoint={import.meta.env.VITE_API_BASE_URL + "/sensor-data/range"}
						// Optional realtime:
						supabaseUrl={import.meta.env.VITE_SUPABASE_URL}
						supabaseAnonKey={import.meta.env.VITE_SUPABASE_ANON_KEY}
						tableName="sensor_data"
						initialView={{
							center: [-76.485954, 44.231172],
							zoom: 14,
						}}
					/>
				</div>
			</div>
		</>
	);
}
