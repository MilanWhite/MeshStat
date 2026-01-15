import Sidebar from "../../components/Sidebar";
import SensorDataCharts from "../../components/SensorDataCharts";

export default function SensorDataPage() {
	return (
		<>
			<Sidebar>
				<div className="w-full h-full flex flex-col gap-3">
					{" "}
					<h1 className=" text-4xl font-bold tracking-tight text-heading md:text-5xl lg:text-4xl">
						Sensor Data
					</h1>
					<p className="mb-4 text-lg text-body">
						Interact with and analyze temperature/sound data
						collected from our sensors.
					</p>
					<SensorDataCharts
						sensorsEndpoint={
							import.meta.env.VITE_API_BASE_URL + "/sensors"
						}
						seriesEndpoint={
							import.meta.env.VITE_API_BASE_URL +
							"/sensor-data/series"
						}
					/>
				</div>
			</Sidebar>
		</>
	);
}
