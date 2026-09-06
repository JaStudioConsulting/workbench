import { useState } from "react";
import { GOOGLE_WORKSPACE_CONTAINER_SCOPES } from "@ja/shared-types";
import { authClient } from "../auth-client.js";

function callbackURL() {
  if (typeof window === "undefined") return "/";
  return new URL("/", window.location.origin).toString();
}

export default function LoginButton() {
  const session = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: callbackURL(),
        scopes: GOOGLE_WORKSPACE_CONTAINER_SCOPES,
      });
      if (result?.error) throw new Error("Google sign-in was rejected");
      setBusy(false);
    } catch {
      setError("Sign-in could not be started. Try again.");
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      await authClient.signOut();
    } catch {
      setError("Sign-out could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (session.isPending) {
    return <button type="button" disabled>Checking session…</button>;
  }

  if (session.data?.user) {
    return (
      <div>
        <span>{session.data.user.email}</span>
        <button type="button" onClick={signOut} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={signIn} disabled={busy}>
        {busy ? "Opening Google…" : "Sign in with Google"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
