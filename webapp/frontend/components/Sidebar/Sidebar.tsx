"use client";

import React, { useMemo, useState } from "react";

import { useAuthenticator } from "@aws-amplify/ui-react";
import { signOut } from "aws-amplify/auth";

import {
	Dialog,
	DialogBackdrop,
	DialogPanel,
	Disclosure,
	DisclosureButton,
	DisclosurePanel,
	TransitionChild,
} from "@headlessui/react";
import {
	Bars3Icon,
	MapPinIcon,
	FolderIcon,
	HomeIcon,
	XMarkIcon,
	ChevronRightIcon,
	BeakerIcon,
	ArrowRightStartOnRectangleIcon,
	ClockIcon,
	GlobeAmericasIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { Link, useLocation } from "react-router-dom";

interface SidebarProps {
	children?: React.ReactNode;
}

type NavItem =
	| {
			type: "link";
			name: string;
			href: string;
			icon: React.ComponentType<any>;
	  }
	| {
			type: "dropdown";
			name: string;
			icon: React.ComponentType<any>;
			baseHref: string;
			items: {
				name: string;
				href: string;
				icon: React.ComponentType<any>;
			}[];
	  };

const navigation: NavItem[] = [
	{ type: "link", name: "Dashboard", href: "/dashboard", icon: HomeIcon },
	{ type: "link", name: "Heatmap", href: "/heatmap", icon: MapPinIcon },
	{
		type: "link",
		name: "Sensor Data",
		href: "/sensor-data",
		icon: FolderIcon,
	},

	{
		type: "dropdown",
		name: "Mesh AI",
		icon: BeakerIcon,
		baseHref: "/mesh-ai",
		items: [
			{
				name: "Sensor Predictor",
				href: "/sensor-predictor",
				icon: ClockIcon,
			},
			{
				name: "Sensor Analysis",
				href: "/sensor-analysis",
				icon: MagnifyingGlassIcon,
			},
		],
	},
];

function classNames(...classes: any[]) {
	return classes.filter(Boolean).join(" ");
}

function isActive(pathname: string, href: string) {
	return pathname === href || pathname.startsWith(href + "/");
}

function SidebarNav({
	pathname,
	onNavigate,
}: {
	pathname: string;
	onNavigate?: () => void;
}) {
	return (
		<ul role="list" className="-mx-2 space-y-1">
			{navigation.map((item) => {
				if (item.type === "link") {
					const active = isActive(pathname, item.href);
					return (
						<li key={item.name}>
							<Link
								to={item.href}
								onClick={onNavigate}
								className={classNames(
									active
										? "bg-gray-50 text-indigo-600 dark:bg-white/5 dark:text-white"
										: "text-gray-700 hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white",
									"group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold"
								)}
							>
								<item.icon
									aria-hidden="true"
									className={classNames(
										active
											? "text-indigo-600 dark:text-white"
											: "text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-white",
										"size-6 shrink-0"
									)}
								/>
								{item.name}
							</Link>
						</li>
					);
				}

				const anyChildActive =
					item.items.some((c) => isActive(pathname, c.href)) ||
					isActive(pathname, item.baseHref);
				const defaultOpen = anyChildActive;

				return (
					<li key={item.name}>
						<Disclosure defaultOpen={defaultOpen}>
							{({ open }) => (
								<>
									<DisclosureButton
										className={classNames(
											anyChildActive
												? "bg-gray-50 text-indigo-600 dark:bg-white/5 dark:text-white"
												: "text-gray-700 hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white",
											"group flex w-full items-center gap-x-3 rounded-md p-2 text-left text-sm/6 font-semibold"
										)}
									>
										<item.icon
											aria-hidden="true"
											className={classNames(
												anyChildActive
													? "text-indigo-600 dark:text-white"
													: "text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-white",
												"size-6 shrink-0"
											)}
										/>
										<span className="flex-1">
											{item.name}
										</span>
										<ChevronRightIcon
											aria-hidden="true"
											className={classNames(
												open
													? "rotate-90 text-indigo-600 dark:text-white"
													: "text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-white",
												"size-5 shrink-0 transition-transform"
											)}
										/>
									</DisclosureButton>

									<DisclosurePanel className="mt-1 space-y-1 pl-6 cursor-pointer">
										{item.items.map((child) => {
											const active = isActive(
												pathname,
												child.href
											);
											return (
												<Link
													key={child.name}
													to={child.href}
													onClick={onNavigate}
													className={classNames(
														active
															? "bg-gray-50 text-indigo-600 dark:bg-white/5 dark:text-white"
															: "text-gray-700 hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white",
														"group flex items-center gap-x-2 rounded-md py-2 pr-2 pl-2 text-sm/6 font-medium"
													)}
												>
													<child.icon
														aria-hidden="true"
														className={classNames(
															active
																? "text-indigo-600 dark:text-white"
																: "text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-white",
															"size-5 shrink-0"
														)}
													/>
													<span>{child.name}</span>
												</Link>
											);
										})}
									</DisclosurePanel>
								</>
							)}
						</Disclosure>
					</li>
				);
			})}
		</ul>
	);
}

export default function Sidebar({ children }: SidebarProps) {
	const { pathname } = useLocation();

	const { user } = useAuthenticator((ctx) => [ctx.user]);
	const displayEmail =
		user?.signInDetails?.loginId || user?.username || "Account";

	const [sidebarOpen, setSidebarOpen] = useState(false);

	const [loggingOut, setLoggingOut] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const activeTitle = useMemo(() => {
		for (const item of navigation) {
			if (item.type === "link" && isActive(pathname, item.href))
				return item.name;
			if (item.type === "dropdown") {
				for (const child of item.items) {
					if (isActive(pathname, child.href)) return child.name;
				}
				if (isActive(pathname, item.baseHref)) return item.name;
			}
		}
		return "Dashboard";
	}, [pathname]);

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
											<SidebarNav
												pathname={pathname}
												onNavigate={() =>
													setSidebarOpen(false)
												}
											/>
										</li>

										<li className="mt-2">
											<button
												type="button"
												onClick={handleLogout}
												className={classNames(
													"text-gray-700 hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white",
													"group flex w-full items-center gap-x-3 rounded-md p-2 text-sm/6 font-semibold"
												)}
											>
												<ArrowRightStartOnRectangleIcon
													aria-hidden="true"
													className={classNames(
														"text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-white",
														"size-6 shrink-0"
													)}
												/>
												{loggingOut
													? "Logging out..."
													: "Log Out"}
											</button>

											{err ? (
												<p className="mt-2 text-sm text-red-600 dark:text-red-400">
													{err}
												</p>
											) : null}
										</li>
									</ul>
								</nav>
							</div>
						</DialogPanel>
					</div>
				</Dialog>

				<div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col dark:bg-gray-900">
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
									<SidebarNav pathname={pathname} />
								</li>

								<li>
									<ul role="list" className="-mx-2 space-y-1">
										<li key="log_out">
											<button
												type="button"
												onClick={handleLogout}
												className={classNames(
													"text-gray-700 hover:bg-gray-50 hover:text-indigo-600 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white",
													"group flex w-full items-center gap-x-3 rounded-md p-2 text-sm/6 font-semibold"
												)}
											>
												<ArrowRightStartOnRectangleIcon
													aria-hidden="true"
													className={classNames(
														"text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-white",
														"size-6 shrink-0"
													)}
												/>
												{loggingOut
													? "Logging out..."
													: "Log Out"}
											</button>
											{err ? (
												<p className="mt-2 px-2 text-sm text-red-600 dark:text-red-400">
													{err}
												</p>
											) : null}
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
						{activeTitle}
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
