import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { getProfile, saveProfile } from "./profileService.js";

const EMPTY_PROFILE = { name: "", businessName: "", title: "", phone: "", signature: "", defaultProvince: "" };

export default function ProfilePage() {
  const [state, setState] = useState({ phase: "loading", profile: EMPTY_PROFILE, message: "" });

  useEffect(() => {
    let active = true;
    getProfile()
      .then((profile) => { if (active) setState({ phase: "ready", profile, message: "" }); })
      .catch(() => { if (active) setState({ phase: "error", profile: EMPTY_PROFILE, message: "Profile could not be loaded." }); });
    return () => { active = false; };
  }, []);

  const update = (field) => (event) => setState((current) => ({
    ...current,
    profile: { ...current.profile, [field]: event.target.value },
    message: "",
  }));
  const submit = async (event) => {
    event.preventDefault();
    setState((current) => ({ ...current, phase: "saving", message: "" }));
    try {
      const profile = await saveProfile(state.profile);
      setState({ phase: "ready", profile, message: "Profile saved." });
    } catch {
      setState((current) => ({ ...current, phase: "error", message: "Profile could not be saved." }));
    }
  };

  if (state.phase === "loading") return <section className="rounded-lg border p-6" role="status">Loading profile...</section>;
  return (
    <Card className="max-w-3xl" data-testid="profile-page">
      <CardHeader><CardTitle>Business profile</CardTitle><CardDescription>Used in recruiter outreach drafts and signatures.</CardDescription></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="profile-name">Name</Label><Input id="profile-name" value={state.profile.name} onChange={update("name")} autoComplete="name" /></div>
          <div className="grid gap-1.5"><Label htmlFor="profile-business">Business name</Label><Input id="profile-business" value={state.profile.businessName} onChange={update("businessName")} autoComplete="organization" /></div>
          <div className="grid gap-1.5"><Label htmlFor="profile-title">Title</Label><Input id="profile-title" value={state.profile.title} onChange={update("title")} autoComplete="organization-title" /></div>
          <div className="grid gap-1.5"><Label htmlFor="profile-phone">Phone</Label><Input id="profile-phone" value={state.profile.phone} onChange={update("phone")} autoComplete="tel" /></div>
          <div className="grid gap-1.5"><Label htmlFor="profile-province">Default province</Label><Input id="profile-province" value={state.profile.defaultProvince} onChange={update("defaultProvince")} placeholder="Ontario" /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="profile-signature">Email signature</Label><Textarea id="profile-signature" rows={6} value={state.profile.signature} onChange={update("signature")} /></div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={state.phase === "saving"}><Save size={15} />{state.phase === "saving" ? "Saving..." : "Save profile"}</Button>
            {state.message ? <p className={`text-sm ${state.phase === "error" ? "text-destructive" : "text-muted-foreground"}`} role={state.phase === "error" ? "alert" : "status"}>{state.message}</p> : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
