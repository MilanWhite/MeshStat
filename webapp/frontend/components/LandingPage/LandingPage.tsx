import { URLS } from "../../src/config/navigation";

import ExplodeOnHoverViewer from "../ExplodeOnHoverViewer";

export default function LandingPage() {
	return (
		<div className="bg-white">
			<main>
				{/* Hero section */}
				<div className="relative isolate overflow-x-hidden h-screen bg-white dark:bg-gray-900">
					{/* Background layers (stay behind everything) */}
					<div className="pointer-events-none absolute inset-0 -z-10">
						<svg
							aria-hidden="true"
							className="absolute inset-0 z-10 size-full mask-[radial-gradient(100%_100%_at_top_right,white,transparent)] stroke-gray-200 dark:stroke-white/10"
						>
							<defs>
								<pattern
									x="50%"
									y={-1}
									id="983e3e4c-de6d-4c3f-8d64-b9761d1534cc"
									width={200}
									height={200}
									patternUnits="userSpaceOnUse"
								>
									<path d="M.5 200V.5H200" fill="none" />
								</pattern>
							</defs>
							<svg
								x="50%"
								y={-1}
								className="overflow-visible fill-gray-50 dark:fill-gray-800/20"
							>
								<path
									d="M-200 0h201v201h-201Z M600 0h201v201h-201Z M-400 600h201v201h-201Z M200 800h201v201h-201Z"
									strokeWidth={0}
								/>
							</svg>
							<rect
								fill="url(#983e3e4c-de6d-4c3f-8d64-b9761d1534cc)"
								width="100%"
								height="100%"
								strokeWidth={0}
							/>
						</svg>

						<div
							aria-hidden="true"
							className="absolute top-10 left-[calc(50%-4rem)] transform-gpu blur-3xl sm:left-[calc(50%-18rem)] lg:top-[calc(50%-30rem)] lg:left-48 xl:left-[calc(50%-24rem)]"
						>
							<div
								style={{
									clipPath:
										"polygon(73.6% 51.7%, 91.7% 11.8%, 100% 46.4%, 97.4% 82.2%, 92.5% 84.9%, 75.7% 64%, 55.3% 47.5%, 46.5% 49.4%, 45% 62.9%, 50.3% 87.2%, 21.3% 64.1%, 0.1% 100%, 5.4% 51.1%, 21.4% 63.9%, 58.9% 0.2%, 73.6% 51.7%)",
								}}
								className="aspect-1108/632 w-277 bg-linear-to-r from-[#80caff] to-[#4f46e5] opacity-20"
							/>
						</div>

						{/* Bottom “coming out” image (behind content) */}
						<div className="absolute inset-x-0 bottom-0 opacity-65">
							<img
								src="../../src/assets/city_view_cropped_edited_1.png"
								alt=""
								className="h-100 w-full object-cover object-top"
							/>
						</div>
					</div>

					{/* Foreground content */}
					<div className="mx-auto h-full max-w-7xl px-6 lg:px-8">
						<div className="grid h-full items-center pb-20 gap-10 lg:grid-cols-2">
							{/* Left: text */}
							<div className="max-w-2xl">
								<img
									alt="Your Company"
									src="../../src/assets/meshstat_logo_white.svg"
									className="h-11 dark:hidden"
								/>
								<img
									alt="Your Company"
									src="../../src/assets/meshstat_logo_white.svg"
									className="h-11 not-dark:hidden"
								/>

								<h1 className="mt-10 text-5xl font-semibold tracking-tight text-pretty text-gray-900 sm:text-5xl dark:text-white">
									We turn street-level signals into city-level
									action.
								</h1>
								<p className="mt-6 text-lg max-w-150 font-medium text-pretty text-gray-500 sm:text-md dark:text-gray-400">
									Sensor-network monitoring for temperature +
									environmental conditions, with live maps,
									replay, and automated insights - supported
									by census and climate data.
								</p>

								<div className="mt-8 flex items-center gap-x-6">
									<a
										href="#general_homepage_heatmap_id"
										className="rounded-md bg-indigo-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
									>
										Our Heatmap
									</a>
									<a
										href={URLS.signIn}
										className="text-sm/6 font-semibold text-gray-900 dark:text-white"
									>
										Log in <span aria-hidden="true">→</span>
									</a>
								</div>
							</div>

							{/* Right: 3D viewer */}
							<div className="relative">
								<div className="h-[560] w-full overflow-hidden rounded-2xl">
									<ExplodeOnHoverViewer />
								</div>
							</div>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
