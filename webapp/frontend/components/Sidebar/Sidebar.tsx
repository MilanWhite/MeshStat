"use client";

import React, { useState } from "react";

import { useAuthenticator } from "@aws-amplify/ui-react";
import { signOut } from "aws-amplify/auth";

import {
	Dialog,
	DialogBackdrop,
	DialogPanel,
	TransitionChild,
} from "@headlessui/react";
import {
	Bars3Icon,
	MapPinIcon,
	BeakerIcon,
	ArrowRightStartOnRectangleIcon,
	FolderIcon,
	HomeIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import { Link, useLocation } from "react-router-dom";

interface SidebarProps {
	children?: React.ReactNode;
}

const navigation = [
	{ name: "Dashboard", href: "/dashboard", icon: HomeIcon },
	{ name: "Heatmap", href: "/heatmap", icon: MapPinIcon },
	{
		name: "Sensor Data",
		href: "/sensor-data",
		icon: FolderIcon,
	},
	{ name: "AI Tools", href: "/ai-tools", icon: BeakerIcon },
];

function classNames(...classes: any[]) {
	return classes.filter(Boolean).join(" ");
}

export default function Sidebar({ children }: SidebarProps) {
	const { pathname } = useLocation();

	const { user } = useAuthenticator((ctx) => [ctx.user]);
	const displayEmail =
		user?.signInDetails?.loginId || user?.username || "Account";

	const [sidebarOpen, setSidebarOpen] = useState(false);

	// Log out logic
	const [loggingOut, setLoggingOut] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	async function handleLogout() {
		setErr(null);
		setLoggingOut(true);
		try {
			await signOut();
			window.location.href = "/";
		} catch (e: any) {
			setErr(e?.message ?? "Logout failed");
			setLoggingOut(false);
		}
	}

	return (
		<>
			{/*
        This example requires updating your template:

        ```
        <html class="h-full bg-white dark:bg-gray-900">
        <body class="h-full">
        ```
      */}
			<div>
				<Dialog
					open={sidebarOpen}
					onClose={setSidebarOpen}
					className="relative z-50 lg:hidden"
				>
					<DialogBackdrop
						transition
						className="fixed inset-0 bg-gray-900/80 transition-opacity duration-300 ease-linear data-closed:opacity-0"
					/>

					<div className="fixed inset-0 flex">
						<DialogPanel
							transition
							className="relative mr-16 flex w-full max-w-xs flex-1 transform transition duration-300 ease-in-out data-closed:-translate-x-full"
						>
							<TransitionChild>
								<div className="absolute top-0 left-full flex w-16 justify-center pt-5 duration-300 ease-in-out data-closed:opacity-0">
									<button
										type="button"
										onClick={() => setSidebarOpen(false)}
										className="-m-2.5 p-2.5"
									>
										<span className="sr-only">
											Close sidebar
										</span>
										<XMarkIcon
											aria-hidden="true"
											className="size-6 text-white"
										/>
									</button>
								</div>
							</TransitionChild>

							{/* Sidebar component, swap this element with another sidebar if you like */}
							<div className="relative flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-2 dark:bg-gray-900 dark:ring dark:ring-white/10 dark:before:pointer-events-none dark:before:absolute dark:before:inset-0 dark:before:bg-black/10">
								<div className="relative flex h-16 shrink-0 items-center">
									<img
										alt="Your Company"
										src="../../src/assets/meshstat_logo_white.svg"
										className="h-8 w-auto dark:hidden"
									/>
									<img
										alt="Your Company"
										src="../../src/assets/meshstat_logo_white.svg"
										className="h-8 w-auto not-dark:hidden"
									/>
								</div>
								<nav className="relative flex flex-1 flex-col">
									<ul
										role="list"
										className="flex flex-1 flex-col gap-y-7"
									>
										<li>
											<ul
												role="list"
												className="-mx-2 space-y-1"
											>
												{navigation.map((item) => (
													<li key={item.name}>
														1
														<Link
															to={item.href}
															className={classNames(
																pathname ===
																	item.href ||
																	pathname.startsWith(
																		item.href +
																			"/"
																	)
																	? "bg-gray-50 text-indigo-600 dark:bg-white/5 dark:text-white"
																	: "text-gray-700 hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white",
																"group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold"
															)}
														>
															<item.icon
																aria-hidden="true"
																className={classNames(
																	pathname ===
																		item.href ||
																		pathname.startsWith(
																			item.href +
																				"/"
																		)
																		? "text-indigo-600 dark:text-white"
																		: "text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-white",
																	"size-6 shrink-0"
																)}
															/>
															{item.name}
														</Link>
													</li>
												))}
											</ul>
										</li>
									</ul>
								</nav>
							</div>
						</DialogPanel>
					</div>
				</Dialog>

				{/* Static sidebar for desktop */}
				<div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col dark:bg-gray-900">
					{/* Sidebar component, swap this element with another sidebar if you like */}
					<div className="flex grow flex-col gap-y-5 overflow-y-auto border-r border-gray-200 bg-white px-6 dark:border-white/10 dark:bg-black/10">
						<div className="flex h-16 shrink-0 items-center">
							<img
								alt="Your Company"
								src="../../src/assets/meshstat_logo_white.svg"
								className="h-8 w-auto dark:hidden"
							/>
							<img
								alt="Your Company"
								src="../../src/assets/meshstat_logo_white.svg"
								className="h-8 w-auto not-dark:hidden"
							/>
						</div>
						<nav className="flex flex-1 flex-col">
							<ul
								role="list"
								className="flex flex-1 flex-col gap-y-7"
							>
								<li>
									<ul
										role="list"
										className="flex flex-1 flex-col gap-y-7"
									>
										<li>
											<ul
												role="list"
												className="-mx-2 space-y-1"
											>
												{navigation.map((item) => (
													<li key={item.name}>
														<a
															href={item.href}
															className={classNames(
																pathname ===
																	item.href ||
																	pathname.startsWith(
																		item.href +
																			"/"
																	)
																	? "bg-gray-50 text-indigo-600 dark:bg-white/5 dark:text-white"
																	: "text-gray-700 hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white",
																"group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold"
															)}
														>
															<item.icon
																aria-hidden="true"
																className={classNames(
																	pathname ===
																		item.href ||
																		pathname.startsWith(
																			item.href +
																				"/"
																		)
																		? "text-indigo-600 dark:text-white"
																		: "text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-white",
																	"size-6 shrink-0"
																)}
															/>
															{item.name}
														</a>
													</li>
												))}
											</ul>
										</li>
									</ul>
								</li>

								<li>
									<ul role="list" className="-mx-2 space-y-1">
										<li key="log_out">
											<a
												onClick={handleLogout}
												className={classNames(
													"text-gray-700 cursor-pointer hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold"
												)}
											>
												<ArrowRightStartOnRectangleIcon
													aria-hidden="true"
													className={classNames(
														"text-gray-400 cursor-pointer group-hover:text-indigo-600 dark:group-hover:text-white size-6 shrink-0"
													)}
												/>
												{loggingOut
													? "Logging out..."
													: "Log Out"}
											</a>
										</li>
									</ul>
								</li>
								<li className="-mx-6 mt-auto">
									<a
										href="#"
										className="flex items-center gap-x-4 px-6 py-3 text-sm/6 font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
									>
										<img
											alt=""
											src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
												(
													displayEmail?.[0] ?? "A"
												).toUpperCase()
											)}&length=1&background=4f39f6&color=ffffff&rounded=true&bold=true&size=128`}
											className="size-8 rounded-full bg-gray-800 outline -outline-offset-1 outline-white/10"
										/>
										<span className="sr-only">
											Your profile
										</span>
										<span aria-hidden="true">
											{displayEmail}
										</span>
									</a>
								</li>
							</ul>
						</nav>
					</div>
				</div>

				<div className="sticky top-0 z-40 flex items-center gap-x-6 bg-white px-4 py-4 shadow-xs sm:px-6 lg:hidden dark:bg-gray-900 dark:shadow-none dark:after:pointer-events-none dark:after:absolute dark:after:inset-0 dark:after:border-b dark:after:border-white/10 dark:after:bg-black/10">
					<button
						type="button"
						onClick={() => setSidebarOpen(true)}
						className="-m-2.5 p-2.5 text-gray-700 hover:text-gray-900 lg:hidden dark:text-gray-400 dark:hover:text-white"
					>
						<span className="sr-only">Open sidebar</span>
						<Bars3Icon aria-hidden="true" className="size-6" />
					</button>
					<div className="flex-1 text-sm/6 font-semibold text-gray-900 dark:text-white">
						Dashboard
					</div>
					<a href="#">
						<span className="sr-only">Your profile</span>
						<img
							alt=""
							src={`https://ui-avatars.com/api/?name=${encodeURIComponent(
								(displayEmail?.[0] ?? "A").toUpperCase()
							)}&length=1&background=4f39f6&color=ffffff&rounded=true&bold=true&size=128`}
							className="size-8 rounded-full bg-gray-800 outline -outline-offset-1 outline-white/10"
						/>
					</a>
				</div>

				<main className="py-10 lg:pl-72">
					<div className="px-4 sm:px-6 lg:px-8">{children}</div>
				</main>
			</div>
		</>
	);
}
