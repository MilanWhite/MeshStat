// SignInInvestor.tsx
// Email + password sign-in (Amplify v6).
// Includes:
// - Forgot Password (request + confirm)
// - Temporary password first-login flow (CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED -> confirmSignIn)

import { useState } from "react";
import {
	signIn,
	confirmSignIn,
	resetPassword,
	confirmResetPassword,
} from "aws-amplify/auth";

type Step =
	| "SIGN_IN"
	| "RESET_REQUEST"
	| "RESET_CONFIRM"
	| "NEW_PASSWORD_REQUIRED"
	| "SIGNIN_CONFIRM_CODE";

type PendingSignInCodeStep =
	| "CONFIRM_SIGN_IN_WITH_EMAIL_CODE"
	| "CONFIRM_SIGN_IN_WITH_SMS_CODE"
	| "CONFIRM_SIGN_IN_WITH_TOTP_CODE"
	| null;

export default function SignIn() {
	const [step, setStep] = useState<Step>("SIGN_IN");

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	// Used for password reset (forgot password)
	const [code, setCode] = useState("");
	const [newPassword, setNewPassword] = useState("");

	// Used for "temporary password -> set real password" flow
	const [firstLoginNewPassword, setFirstLoginNewPassword] = useState("");
	const [firstLoginNewPassword2, setFirstLoginNewPassword2] = useState("");

	// Used for confirmSignIn code challenges (email/sms/totp)
	const [signInCode, setSignInCode] = useState("");
	const [pendingSignInCodeStep, setPendingSignInCodeStep] =
		useState<PendingSignInCodeStep>(null);

	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	function resetErrors() {
		setErr(null);
	}

	function goToSignIn() {
		setStep("SIGN_IN");
		setPassword("");
		setFirstLoginNewPassword("");
		setFirstLoginNewPassword2("");
		setSignInCode("");
		setPendingSignInCodeStep(null);
	}

	function signInCodePromptLabel() {
		switch (pendingSignInCodeStep) {
			case "CONFIRM_SIGN_IN_WITH_EMAIL_CODE":
				return "Enter the code sent to your email";
			case "CONFIRM_SIGN_IN_WITH_SMS_CODE":
				return "Enter the code sent by SMS";
			case "CONFIRM_SIGN_IN_WITH_TOTP_CODE":
				return "Enter the code from your authenticator app";
			default:
				return "Enter your verification code";
		}
	}

	async function handleSignIn(e: React.FormEvent) {
		e.preventDefault();
		resetErrors();
		setLoading(true);

		try {
			const { isSignedIn, nextStep } = await signIn({
				username: email,
				password,
			});

			if (isSignedIn) {
				window.location.reload();
				return;
			}

			// Multi-step sign-in handling (v6)
			const signInStep = nextStep?.signInStep;

			if (signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
				// User signed in with a temporary password; must set a new one
				setStep("NEW_PASSWORD_REQUIRED");
				setFirstLoginNewPassword("");
				setFirstLoginNewPassword2("");
				return;
			}

			if (
				signInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" ||
				signInStep === "CONFIRM_SIGN_IN_WITH_SMS_CODE" ||
				signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE"
			) {
				setPendingSignInCodeStep(signInStep);
				setStep("SIGNIN_CONFIRM_CODE");
				setSignInCode("");
				return;
			}

			setErr(
				signInStep
					? `Additional sign-in step required: ${signInStep}`
					: "Sign-in did not complete."
			);
		} catch (ex: any) {
			setErr(ex?.message ?? "Sign in failed");
		} finally {
			setLoading(false);
		}
	}

	// Called after NEW_PASSWORD_REQUIRED: confirmSignIn({ challengeResponse: newPassword })
	async function handleFirstLoginSetPassword(e: React.FormEvent) {
		e.preventDefault();
		resetErrors();

		if (!firstLoginNewPassword || firstLoginNewPassword.length < 8) {
			setErr("Password must be at least 8 characters.");
			return;
		}
		if (firstLoginNewPassword !== firstLoginNewPassword2) {
			setErr("Passwords do not match.");
			return;
		}

		setLoading(true);
		try {
			const { isSignedIn, nextStep } = await confirmSignIn({
				challengeResponse: firstLoginNewPassword,
			});

			if (isSignedIn) {
				window.location.reload();
				return;
			}

			const signInStep = nextStep?.signInStep;

			// If your pool enforces MFA, Cognito may require an additional step after setting the password.
			if (
				signInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE" ||
				signInStep === "CONFIRM_SIGN_IN_WITH_SMS_CODE" ||
				signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE"
			) {
				setPendingSignInCodeStep(signInStep);
				setStep("SIGNIN_CONFIRM_CODE");
				setSignInCode("");
				return;
			}

			setErr(
				signInStep
					? `Additional sign-in step required: ${signInStep}`
					: "Password was set, but sign-in did not complete."
			);
		} catch (ex: any) {
			setErr(ex?.message ?? "Failed to set new password");
		} finally {
			setLoading(false);
		}
	}

	// For MFA / Email/SMS/TOTP code steps during sign-in
	async function handleConfirmSignInCode(e: React.FormEvent) {
		e.preventDefault();
		resetErrors();
		setLoading(true);

		try {
			const { isSignedIn, nextStep } = await confirmSignIn({
				challengeResponse: signInCode.trim(),
			});

			if (isSignedIn) {
				window.location.reload();
				return;
			}

			const signInStep = nextStep?.signInStep;
			setErr(
				signInStep
					? `Additional sign-in step required: ${signInStep}`
					: "Sign-in did not complete."
			);
		} catch (ex: any) {
			setErr(ex?.message ?? "Confirm sign-in failed");
		} finally {
			setLoading(false);
		}
	}

	async function handleResetRequest(e: React.MouseEvent) {
		e.preventDefault();
		resetErrors();
		setLoading(true);

		try {
			const { nextStep } = await resetPassword({ username: email });
			if (
				nextStep.resetPasswordStep ===
				"CONFIRM_RESET_PASSWORD_WITH_CODE"
			) {
				setStep("RESET_CONFIRM");
			}
		} catch (ex: any) {
			setErr(ex?.message ?? "Reset request failed");
		} finally {
			setLoading(false);
		}
	}

	async function handleResetConfirm(e: React.FormEvent) {
		e.preventDefault();
		resetErrors();
		setLoading(true);

		try {
			await confirmResetPassword({
				username: email,
				confirmationCode: code.trim(),
				newPassword,
			});
			goToSignIn();
			setCode("");
			setNewPassword("");
		} catch (ex: any) {
			setErr(ex?.message ?? "Reset confirm failed");
		} finally {
			setLoading(false);
		}
	}

	const title =
		step === "SIGN_IN"
			? "Sign in to your account"
			: step === "RESET_REQUEST"
			? "Reset password"
			: step === "RESET_CONFIRM"
			? "Enter reset code"
			: step === "NEW_PASSWORD_REQUIRED"
			? "Set a new password"
			: "Confirm sign-in";

	return (
		<div className="flex min-h-full flex-col justify-center px-6 py-30 lg:px-8">
			<div className="sm:mx-auto sm:w-full sm:max-w-sm">
				<img
					alt="Your Company"
					src="../../src/assets/meshstat_logo_white.svg"
					className="mx-auto h-20 w-auto dark:hidden"
				/>
				<img
					alt="Your Company"
					src="../../src/assets/meshstat_logo_white.svg"
					className="mx-auto h-20 w-auto not-dark:hidden"
				/>
				<h2 className="mt-10 text-center text-2xl/9 font-bold tracking-tight text-gray-900 dark:text-white">
					{title}
				</h2>
			</div>

			<div className="mt-10 sm:mx-auto sm:w-full sm:max-w-sm">
				{step === "SIGN_IN" && (
					<form onSubmit={handleSignIn} className="space-y-6">
						<div>
							<label
								htmlFor="email"
								className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100"
							>
								Email address
							</label>
							<div className="mt-2">
								<input
									id="email"
									name="email"
									type="email"
									required
									autoComplete="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
								/>
							</div>
						</div>

						<div>
							<div className="flex items-center justify-between">
								<label
									htmlFor="password"
									className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100"
								>
									Password
								</label>
								<div className="text-sm">
									<a
										href="#"
										onClick={(e) => {
											e.preventDefault();
											setStep("RESET_REQUEST");
										}}
										className="font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
									>
										Forgot password?
									</a>
								</div>
							</div>
							<div className="mt-2">
								<input
									id="password"
									name="password"
									type="password"
									required
									autoComplete="current-password"
									value={password}
									onChange={(e) =>
										setPassword(e.target.value)
									}
									className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
								/>
							</div>
						</div>

						{err && (
							<p className="text-sm text-red-600 dark:text-red-400">
								{err}
							</p>
						)}

						<div>
							<button
								type="submit"
								disabled={loading}
								className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-indigo-500 dark:shadow-none dark:hover:bg-indigo-400 dark:focus-visible:outline-indigo-500"
							>
								{loading ? "Signing in..." : "Sign in"}
							</button>
						</div>
					</form>
				)}

				{step === "NEW_PASSWORD_REQUIRED" && (
					<form
						onSubmit={handleFirstLoginSetPassword}
						className="space-y-6"
					>
						<p className="text-sm text-gray-600 dark:text-gray-300">
							You signed in with a temporary password. Set a new
							password to continue.
						</p>

						<div>
							<label
								htmlFor="first-login-new-password"
								className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100"
							>
								New password
							</label>
							<div className="mt-2">
								<input
									id="first-login-new-password"
									name="first-login-new-password"
									type="password"
									required
									autoComplete="new-password"
									value={firstLoginNewPassword}
									onChange={(e) =>
										setFirstLoginNewPassword(e.target.value)
									}
									className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
								/>
							</div>
						</div>

						<div>
							<label
								htmlFor="first-login-new-password-2"
								className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100"
							>
								Confirm new password
							</label>
							<div className="mt-2">
								<input
									id="first-login-new-password-2"
									name="first-login-new-password-2"
									type="password"
									required
									autoComplete="new-password"
									value={firstLoginNewPassword2}
									onChange={(e) =>
										setFirstLoginNewPassword2(
											e.target.value
										)
									}
									className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
								/>
							</div>
						</div>

						{err && (
							<p className="text-sm text-red-600 dark:text-red-400">
								{err}
							</p>
						)}

						<div className="flex gap-2">
							<button
								type="submit"
								disabled={loading}
								className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-60"
							>
								{loading ? "Setting..." : "Set password"}
							</button>
							<button
								type="button"
								onClick={goToSignIn}
								className="flex w-full justify-center rounded-md border px-3 py-1.5 text-sm/6 font-semibold"
							>
								Back
							</button>
						</div>
					</form>
				)}

				{step === "SIGNIN_CONFIRM_CODE" && (
					<form
						onSubmit={handleConfirmSignInCode}
						className="space-y-6"
					>
						<div>
							<label
								htmlFor="signin-code"
								className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100"
							>
								{signInCodePromptLabel()}
							</label>
							<div className="mt-2">
								<input
									id="signin-code"
									name="signin-code"
									type="text"
									inputMode="numeric"
									pattern="[0-9]*"
									required
									value={signInCode}
									onChange={(e) =>
										setSignInCode(e.target.value)
									}
									className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
								/>
							</div>
						</div>

						{err && (
							<p className="text-sm text-red-600 dark:text-red-400">
								{err}
							</p>
						)}

						<div className="flex gap-2">
							<button
								type="submit"
								disabled={loading}
								className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-60"
							>
								{loading ? "Confirming..." : "Confirm"}
							</button>
							<button
								type="button"
								onClick={goToSignIn}
								className="flex w-full justify-center rounded-md border px-3 py-1.5 text-sm/6 font-semibold"
							>
								Back
							</button>
						</div>
					</form>
				)}

				{step === "RESET_REQUEST" && (
					<form
						onSubmit={(e) => {
							e.preventDefault();
						}}
						className="space-y-6"
					>
						<div>
							<label
								htmlFor="email-reset"
								className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100"
							>
								Enter your email
							</label>
							<div className="mt-2">
								<input
									id="email-reset"
									name="email-reset"
									type="email"
									required
									autoComplete="email"
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
								/>
							</div>
						</div>

						{err && (
							<p className="text-sm text-red-600 dark:text-red-400">
								{err}
							</p>
						)}

						<div className="flex gap-2">
							<button
								type="button"
								onClick={handleResetRequest}
								disabled={loading || !email}
								className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-60"
							>
								{loading
									? "Sending code..."
									: "Send reset code"}
							</button>
							<button
								type="button"
								onClick={goToSignIn}
								className="flex w-full justify-center rounded-md border px-3 py-1.5 text-sm/6 font-semibold"
							>
								Back
							</button>
						</div>
					</form>
				)}

				{step === "RESET_CONFIRM" && (
					<form onSubmit={handleResetConfirm} className="space-y-6">
						<div>
							<label
								htmlFor="code"
								className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100"
							>
								Enter the 6-digit code sent to {email}
							</label>
							<div className="mt-2">
								<input
									id="code"
									name="code"
									type="text"
									inputMode="numeric"
									pattern="[0-9]*"
									required
									value={code}
									onChange={(e) => setCode(e.target.value)}
									className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
								/>
							</div>
						</div>

						<div>
							<label
								htmlFor="new-password"
								className="block text-sm/6 font-medium text-gray-900 dark:text-gray-100"
							>
								New password
							</label>
							<div className="mt-2">
								<input
									id="new-password"
									name="new-password"
									type="password"
									required
									autoComplete="new-password"
									value={newPassword}
									onChange={(e) =>
										setNewPassword(e.target.value)
									}
									className="block w-full rounded-md bg-white px-3 py-1.5 text-base text-gray-900 outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600 sm:text-sm/6 dark:bg-white/5 dark:text-white dark:outline-white/10 dark:placeholder:text-gray-500 dark:focus:outline-indigo-500"
								/>
							</div>
						</div>

						{err && (
							<p className="text-sm text-red-600 dark:text-red-400">
								{err}
							</p>
						)}

						<div className="flex gap-2">
							<button
								type="submit"
								disabled={loading}
								className="flex w-full justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm/6 font-semibold text-white shadow-xs hover:bg-indigo-500 disabled:opacity-60"
							>
								{loading ? "Updating..." : "Update password"}
							</button>
							<button
								type="button"
								onClick={goToSignIn}
								className="flex w-full justify-center rounded-md border px-3 py-1.5 text-sm/6 font-semibold"
							>
								Back to sign in
							</button>
						</div>
					</form>
				)}

				<p className="mt-2 text-right text-center text-sm/6 text-gray-500 dark:text-gray-400">
					<a
						href="/"
						className="font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
					>
						Go Back
					</a>
				</p>
			</div>
		</div>
	);
}
