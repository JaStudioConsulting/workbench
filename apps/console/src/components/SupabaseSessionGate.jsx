import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, LockKeyhole, Mail } from "lucide-react";
import { supabase } from "../supabase-client.js";

function messageForAuthError(error) {
  if (error?.code === "over_email_send_rate_limit") {
    return "Supabase has temporarily limited login emails. Wait for the hourly quota to reset, then request one link.";
  }
  return error?.message || "The login link could not be sent.";
}

export default function SupabaseSessionGate({ children }) {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setChecking(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession || null);
      setChecking(false);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const sendLink = async (event) => {
    event.preventDefault();
    setSending(true);
    setSent(false);
    setError("");

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

    if (signInError) setError(messageForAuthError(signInError));
    else setSent(true);
    setSending(false);
  };

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f7f5f0] text-stone-900">
        <div className="flex items-center gap-2 text-sm font-semibold" role="status">
          <Loader2 size={16} className="animate-spin" />
          Checking your session
        </div>
      </div>
    );
  }

  if (session) return children;

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f5f0] px-5 py-10 text-stone-950">
      <section className="w-full max-w-md overflow-hidden rounded-2xl border border-stone-300 bg-white shadow-[0_20px_60px_rgba(52,45,35,0.12)]">
        <div className="border-b border-stone-200 bg-stone-950 px-7 py-6 text-white">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-stone-950">
            <LockKeyhole size={19} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight !text-white">JA Workbench</h1>
          <p className="mt-1 text-sm text-stone-300">Private recruiting workspace</p>
        </div>

        <form className="space-y-5 p-7" onSubmit={sendLink}>
          <div>
            <label htmlFor="workbench-email" className="text-sm font-semibold text-stone-800">
              Approved email
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-3 focus-within:border-amber-600 focus-within:ring-2 focus-within:ring-amber-100">
              <Mail size={16} className="text-stone-500" />
              <input
                id="workbench-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your approved email"
                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={sending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 text-sm font-bold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            {sending ? "Sending link" : "Email me a login link"}
          </button>

          {sent ? (
            <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              Check your inbox. The link returns you here.
            </p>
          ) : null}
          {error ? <p role="alert" className="text-sm font-medium text-rose-700">{error}</p> : null}
        </form>
      </section>
    </main>
  );
}
