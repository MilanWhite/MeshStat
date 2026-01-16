import { createRoot } from "react-dom/client";
import "./index.css";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import { URLS } from "./config/navigation.ts";

import { createBrowserRouter, RouterProvider } from "react-router-dom";

import NotFoundPage from "../pages/General/NotFoundPage.tsx";

import SignIn from "../components/Auth/SignIn";
import GeneralHomePage from "../pages/General/GeneralHomePage";
import DashboardPage from "../pages/Authenticated/DashboardPage";
import HeatmapPage from "../pages/Authenticated/HeatmapPage";
import SensorDataPage from "../pages/Authenticated/SensorDataPage.tsx";
import AIToolsPage from "../pages/Authenticated/AIToolsPage";
import SensorPredictor from "../pages/Authenticated/SensorPredictor";
import SensorAnalysis from "../pages/Authenticated/SensorAnalysis";

import { PublicRoute } from "../routers/PublicRoute.tsx";
import { AuthenticatedRoute } from "../routers/AuthenticatedRoute.tsx";

Amplify.configure({
	Auth: {
		Cognito: {
			userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
			userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
		},
	},
});

const router = createBrowserRouter([
	{
		children: [
			// Public Routes - for unauthenticated users

			{
				path: URLS.generalHomePage,
				element: (
					<PublicRoute>
						<GeneralHomePage />
					</PublicRoute>
				),
			},

			{
				path: URLS.signIn,
				element: (
					<PublicRoute>
						<SignIn />
					</PublicRoute>
				),
			},

			// AUthenticated Routes

			{
				path: URLS.dashboardPage,
				element: (
					<AuthenticatedRoute>
						<DashboardPage />
					</AuthenticatedRoute>
				),
			},

			{
				path: URLS.heatmapPage,
				element: (
					<AuthenticatedRoute>
						<HeatmapPage />
					</AuthenticatedRoute>
				),
			},

			{
				path: URLS.sensorDataPage,
				element: (
					<AuthenticatedRoute>
						<SensorDataPage />
					</AuthenticatedRoute>
				),
			},

			{
				path: URLS.aiToolsPage,
				element: (
					<AuthenticatedRoute>
						<AIToolsPage />
					</AuthenticatedRoute>
				),
			},

			{
				path: URLS.sensorPredictor,
				element: (
					<AuthenticatedRoute>
						<SensorPredictor />
					</AuthenticatedRoute>
				),
			},

			{
				path: URLS.sensorAnalysis,
				element: (
					<AuthenticatedRoute>
						<SensorAnalysis />
					</AuthenticatedRoute>
				),
			},

			// 404
			{
				path: "*",
				element: <NotFoundPage />,
			},
		],
	},
]);

createRoot(document.getElementById("root")!).render(
	<Authenticator.Provider>
		<RouterProvider router={router} />
	</Authenticator.Provider>
);
