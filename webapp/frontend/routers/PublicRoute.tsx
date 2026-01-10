// PublicRoute.tsx
import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import CenteredSpinner from "../components/CenteredSpinner";
import { URLS } from "../src/config/navigation";
import { fetchAuthSession } from "aws-amplify/auth";

type Props = {
	children: ReactNode;
	redirectAuthenticatedTo?: string;
};

async function isAuthenticated(): Promise<boolean> {
	try {
		const session = await fetchAuthSession();
		return Boolean(session.tokens?.accessToken || session.tokens?.idToken);
	} catch {
		return false;
	}
}

export function PublicRoute({
	children,
	redirectAuthenticatedTo = (URLS as any).authenticatedHomePage ??
		(URLS as any).appHomePage ??
		(URLS as any).dashboardPage ??
		"/app",
}: Props) {
	const navigate = useNavigate();
	const location = useLocation();
	const [loading, setLoading] = useState(true);
	const [allowed, setAllowed] = useState(false);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const authed = await isAuthenticated();
				if (cancelled) return;

				if (authed) {
					navigate(redirectAuthenticatedTo, { replace: true });
				} else {
					setAllowed(true);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [navigate, redirectAuthenticatedTo, location.pathname]);

	if (loading) return <CenteredSpinner />;
	return <>{allowed ? children : null}</>;
}
