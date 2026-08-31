import { useCallback, useEffect, useMemo, useState } from "react";
import { Cloud } from "lucide-react";
import {
  disconnectGoogleWorkspace,
  getGoogleWorkspaceStatus,
  startGoogleWorkspaceConnection,
  validateGoogleAuthorizationUrl,
} from "../google-workspace-client.js";
import { UpcomingCalendar } from "./UpcomingCalendar.jsx";

const VIEW_BY_PHASE = {
  checking: {
    label: "Checking connection",
    button: "Checking…",
    helper: "Confirming the current Google Workspace connection.",
    tone: "neutral",
  },
  unavailable: {
    label: "Unavailable",
    button: "Connect Google Calendar",
    helper: "Google Workspace connection setup is not available yet.",
    tone: "error",
  },
  unauthenticated: {
    label: "Sign-in required",
    button: "Connect Google Calendar",
    helper: "Sign in to the Workbench before connecting Google Calendar.",
    tone: "error",
  },
  forbidden: {
    label: "Account not approved",
    button: "Connect Google Calendar",
    helper: "This Workbench account is not approved for Google Workspace.",
    tone: "error",
  },
  disconnected: {
    label: "Not connected",
    button: "Connect Google Calendar",
    helper: "Google will ask for read-only Calendar access.",
    tone: "neutral",
  },
  starting: {
    label: "Opening Google",
    button: "Opening Google…",
    helper: "Continue in the Google window to approve read-only Calendar access.",
    tone: "neutral",
  },
  connected: {
    label: "Calendar connected",
    button: "Disconnect",
    helper: "Read-only Calendar access is active.",
    tone: "connected",
  },
  disconnecting: {
    label: "Disconnecting",
    button: "Disconnecting…",
    helper: "Removing this Workbench connection.",
    tone: "neutral",
  },
};

function phaseForError(error) {
  if (error?.status === 401) return "unauthenticated";
  if (error?.status === 403) return "forbidden";
  return "unavailable";
}

function callbackHint() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("googleWorkspace") === "denied"
    ? "Google access was not approved. Nothing was connected."
    : "";
}

export function GoogleWorkspacePanel() {
  const [connection, setConnection] = useState({ phase: "checking", account: null, helper: "" });
  const oauthHint = useMemo(callbackHint, []);

  const checkStatus = useCallback(() => {
    const controller = new AbortController();

    getGoogleWorkspaceStatus({ signal: controller.signal })
      .then((status) => {
        if (status.connected) {
          setConnection({ phase: "connected", account: status.account, helper: "" });
        } else {
          setConnection({ phase: "disconnected", account: null, helper: oauthHint });
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setConnection({ phase: phaseForError(error), account: null, helper: "" });
        }
      });

    return controller;
  }, [oauthHint]);

  useEffect(() => {
    const controller = checkStatus();
    return () => controller.abort();
  }, [checkStatus]);

  const handleConnect = async () => {
    setConnection({ phase: "starting", account: null, helper: "" });
    try {
      const result = await startGoogleWorkspaceConnection();
      const destination = validateGoogleAuthorizationUrl(result.authorizationUrl);
      window.location.assign(destination);
    } catch (error) {
      setConnection({ phase: phaseForError(error), account: null, helper: "" });
    }
  };

  const handleDisconnect = async () => {
    const previousAccount = connection.account;
    setConnection({ phase: "disconnecting", account: previousAccount, helper: "" });
    try {
      const status = await disconnectGoogleWorkspace();
      if (status.connected) {
        setConnection({ phase: "connected", account: status.account, helper: "Disconnect did not complete." });
      } else {
        setConnection({ phase: "disconnected", account: null, helper: "Google Calendar was disconnected." });
      }
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        setConnection({ phase: phaseForError(error), account: null, helper: "" });
      } else {
        setConnection({ phase: "connected", account: previousAccount, helper: "Calendar could not be disconnected. Try again." });
      }
    }
  };

  const view = VIEW_BY_PHASE[connection.phase];
  const canConnect = connection.phase === "disconnected";
  const canDisconnect = connection.phase === "connected";
  const helper = connection.helper || view.helper;

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
        <p>Connect Google Calendar to see upcoming events in the Workbench.</p>
        <p className="google-workspace-scope">Calendar is read-only. Gmail, Drive, Docs, Sheets, and other Workspace tools remain disconnected.</p>
      </div>

      <div className="google-workspace-action">
        <span className={`connection-status is-${view.tone}`} aria-live="polite">
          <span aria-hidden="true" />{view.label}
        </span>
        {connection.account?.email ? <strong className="connected-account">{connection.account.email}</strong> : null}
        <button
          type="button"
          onClick={canDisconnect ? handleDisconnect : handleConnect}
          disabled={!canConnect && !canDisconnect}
        >
          {view.button}
        </button>
        <small>{helper}</small>
      </div>

      {connection.phase === "connected" ? <UpcomingCalendar /> : null}
    </section>
  );
}
