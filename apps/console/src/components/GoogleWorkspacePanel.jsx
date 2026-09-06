import { useEffect, useState } from "react";
import { Cloud } from "lucide-react";
import { authClient } from "../auth-client.js";
import { getGoogleWorkspaceStatus } from "../google-workspace-client.js";
import LoginButton from "./LoginButton.tsx";
import { UpcomingCalendar } from "./UpcomingCalendar.jsx";

const SERVICES = ["Calendar", "Gmail", "Drive", "Sheets"];

export function GoogleWorkspacePanel() {
  const session = authClient.useSession();
  const pending = session.isPending;
  const account = session.data?.user?.email;
  const sessionError = session.error ? "The Google account connection could not be checked." : "";
  const [calendarStatus, setCalendarStatus] = useState("checking");

  useEffect(() => {
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
        <p>Connect one Google account to use Calendar, Gmail, Drive, and Sheets in the Workbench.</p>
        <p className="google-workspace-scope">Access is managed by Better Auth. The Workbench never handles or stores Google tokens in the browser.</p>
      </div>

      <div className="google-workspace-action">
        <span className={`connection-status is-${pending ? "neutral" : account ? "connected" : "error"}`} aria-live="polite">
          <span aria-hidden="true" />{pending ? "Checking session" : account ? "Google account linked" : "Sign-in required"}
        </span>
        {account ? <strong className="connected-account">{account}</strong> : null}
        {pending ? <small>Confirming the current Better Auth session.</small> : <LoginButton />}
        {sessionError ? <small role="alert">{sessionError}</small> : null}
      </div>

      <div aria-label="Google Workspace services">
        {SERVICES.map((service) => <span key={service}>{service}</span>)}
      </div>
      {calendarStatus === "connected" ? <UpcomingCalendar /> : null}
    </section>
  );
}
