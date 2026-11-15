import { useEffect, useState } from "react";
import { Cloud } from "lucide-react";
import { authClient } from "../auth-client.js";
import { getGoogleWorkspaceStatus, getWorkbenchAuthStatus, googleConnectionGuidance } from "../google-workspace-client.js";
import { UpcomingCalendar } from "./UpcomingCalendar.jsx";
import LoginButton from "./LoginButton.tsx";
import { calendarEnabled } from "../featureFlags.js";

const SERVICES = calendarEnabled ? ["Calendar", "Sheets"] : ["Sheets"];

export function GoogleWorkspacePanel() {
  const session = authClient.useSession();
  const pending = session.isPending;
  const account = session.data?.user?.email;
  const [authAvailability, setAuthAvailability] = useState({ phase: "checking", googleSignIn: "unavailable", localDataSession: "unavailable" });
  const [calendarStatus, setCalendarStatus] = useState("checking");

  useEffect(() => {
    const controller = new AbortController();
    getWorkbenchAuthStatus({ signal: controller.signal })
      .then((status) => setAuthAvailability({ phase: "ready", ...status }))
      .catch((error) => {
        if (error?.name !== "AbortError") setAuthAvailability({ phase: "error", googleSignIn: "unavailable", localDataSession: "unavailable" });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!calendarEnabled) return undefined;
    if (!account) {
      setCalendarStatus("disconnected");
      return undefined;
    }
    const controller = new AbortController();
    getGoogleWorkspaceStatus({ signal: controller.signal })
      .then((status) => setCalendarStatus(status.connected ? "connected" : "disconnected"))
      .catch((error) => {
        if (error?.name !== "AbortError") setCalendarStatus("unavailable");
      });
    return () => controller.abort();
  }, [account]);

  const googleUnavailable = authAvailability.phase === "ready" && authAvailability.googleSignIn === "unavailable";
  const capabilityError = authAvailability.phase === "error";
  const statusText = pending || authAvailability.phase === "checking"
    ? "Checking Google sign-in"
    : googleUnavailable
      ? "Google sign-in unavailable"
      : capabilityError || session.error
        ? "Google status unavailable"
        : account
          ? calendarEnabled && calendarStatus === "connected" ? "Google account connected" : "Google sign-in active"
          : "Google sign-in required";
  const recoveryText = googleUnavailable
    ? `${authAvailability.localDataSession === "configured" ? "Your private Workbench data session is active. " : ""}${googleConnectionGuidance("AUTH_UNAVAILABLE").message}`
    : capabilityError || session.error
      ? "Google sign-in status could not be checked. Check your connection and reload Settings."
      : calendarEnabled && account && calendarStatus === "disconnected"
        ? "Calendar access is not connected. Sign out, then sign in with Google again and approve the requested access."
        : calendarEnabled && account && calendarStatus === "unavailable"
          ? "Google Workspace status could not be checked. Check your connection and reload Settings."
          : "";

  return (
    <section className="google-workspace-panel" aria-labelledby="google-workspace-title">
      <div className="google-workspace-copy">
        <div className="google-workspace-title">
          <span className="google-workspace-icon" aria-hidden="true">
            <Cloud size={22} />
          </span>
          <div>
            <span className="eyebrow">INTEGRATIONS</span>
            <h2 id="google-workspace-title">Google Workspace</h2>
          </div>
        </div>
        <p>Connect one Google account to import Sheets data.</p>
        <p className="google-workspace-scope">Access is managed by Better Auth. The Workbench never handles or stores Google tokens in the browser.</p>
      </div>

      <div className="google-workspace-action">
        <span className={`connection-status is-${pending || authAvailability.phase === "checking" ? "neutral" : account && (!calendarEnabled || calendarStatus === "connected") ? "connected" : "error"}`} aria-live="polite">
          <span aria-hidden="true" />{statusText}
        </span>
        {account ? <strong className="connected-account">{account}</strong> : null}
        {pending || authAvailability.phase === "checking" ? <small>Confirming the Better Auth Google session.</small> : null}
        {!pending && authAvailability.phase === "ready" && authAvailability.googleSignIn === "configured" ? <LoginButton /> : null}
        {recoveryText ? <small role="alert">{recoveryText}</small> : null}
      </div>

      <div aria-label="Google Workspace services">
        {SERVICES.map((service) => <span key={service}>{service}</span>)}
      </div>
      {calendarEnabled && calendarStatus === "connected" ? <UpcomingCalendar /> : null}
    </section>
  );
}
