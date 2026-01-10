// AuthenticatedRoute.tsx
import { type ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import CenteredSpinner from "../components/CenteredSpinner";
import { URLS } from "../src/config/navigation";
import { fetchAuthSession } from "aws-amplify/auth";

type Props = {
	children: ReactNode;
	redirectUnauthenticatedTo?: string;
};

async function isAuthenticated(): Promise<boolean> {
	try {
		const session = await fetchAuthSession();
		return Boolean(session.tokens?.accessToken || session.tokens?.idToken);
	} catch {
		return false;
	}
}

export function AuthenticatedRoute({
	children,
	redirectUnauthenticatedTo = URLS.generalHomePage,
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
					setAllowed(true);
				} else {
					navigate(redirectUnauthenticatedTo, { replace: true });
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [navigate, redirectUnauthenticatedTo, location.pathname]);

	if (loading) return <CenteredSpinner />;
	return <>{allowed ? children : null}</>;
}
