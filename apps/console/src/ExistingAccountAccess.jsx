import { useState } from "react";
import { requestExistingAccountLink, SIGN_IN_LINK_ERROR_MESSAGE } from "./supabase-auth.js";

export default function ExistingAccountAccess({ sessionError = "" }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [inputError, setInputError] = useState("");

  const requestLink = async (event) => {
    event.preventDefault();
    setInputError("");
    setMessage("");
    setBusy(true);
    try {
      const result = await requestExistingAccountLink(email);
      setMessage(result.message);
    } catch (error) {
      setInputError(error instanceof TypeError ? error.message : SIGN_IN_LINK_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm" aria-labelledby="existing-account-title">
        <p className="text-sm font-semibold text-muted-foreground">JA Workbench</p>
        <h1 id="existing-account-title" className="mt-2 text-2xl font-semibold">Sign in to Workbench</h1>
        <p className="mt-2 text-sm text-muted-foreground">Continue with an existing Workbench email account. This page does not create accounts.</p>
        {sessionError ? <p className="mt-4 text-sm text-destructive" role="alert">{sessionError}</p> : null}

        {message ? (
          <div className="mt-6 rounded-lg border bg-muted/40 p-4" role="status" aria-live="polite">
            <h2 className="font-semibold">Open email link</h2>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
            <button type="button" className="mt-4 min-h-10 rounded-md border bg-background px-3 text-sm font-medium" onClick={() => setMessage("")}>Back to sign in</button>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={requestLink}>
            <div className="space-y-2">
              <label htmlFor="workbench-email" className="text-sm font-medium">Email address</label>
              <input
                id="workbench-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={inputError ? "workbench-email-error" : undefined}
                aria-invalid={inputError ? "true" : undefined}
                className="min-h-11 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {inputError ? <p id="workbench-email-error" className="text-sm text-destructive" role="alert">{inputError}</p> : null}
            </div>
            <button type="submit" disabled={busy} className="min-h-11 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {busy ? "Requesting link…" : "Continue with email"}
            </button>
            <p className="text-xs text-muted-foreground">Only existing Workbench accounts can sign in. If a link does not arrive, check the email address and spam folder, then try again.</p>
          </form>
        )}
      </section>
    </main>
  );
}
