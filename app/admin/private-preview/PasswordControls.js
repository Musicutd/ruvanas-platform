"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PasswordControls({ bootstrap, email }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (working) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (fields.get("password") !== fields.get("confirm")) { setMessage("The new passwords do not match."); return; }
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/admin/private-preview/password", { method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ password: fields.get("password"),
          ...(bootstrap ? {} : { currentPassword: fields.get("currentPassword") }) }) });
      const result = await response.json();
      form.reset();
      if (!response.ok) { setMessage(result.error || "Unable to set your password."); return; }
      setMessage("Admin password saved. Your previous sessions and admin codes have been revoked.");
      router.refresh();
    } catch { form.reset(); setMessage("Unable to set your password. Please try again."); }
    finally { setWorking(false); }
  }
  const style = { display: "block", padding: 10, margin: "8px 0 16px", width: "100%", maxWidth: 440 };
  return <section style={{ border: "1px solid #a9b7c9", borderRadius: 12, padding: 24, marginTop: 20 }}>
    <h2>{bootstrap ? "Set your admin password once" : "Change your admin password"}</h2>
    <p>Your sign-in username is <strong>{email}</strong>. Use at least 12 characters (maximum 72 UTF-8 bytes). Your original account and supplier passwords are not changed.</p>
    <form onSubmit={submit}>
      <input type="text" autoComplete="username" value={email} readOnly aria-label="Admin email" style={style} />
      {!bootstrap ? <label>Current preview password<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={72} style={style} /></label> : null}
      <label>New preview password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72} style={style} /></label>
      <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={72} style={style} /></label>
      <button disabled={working} type="submit">{working ? "Saving…" : "Save admin password"}</button>
    </form>
    {message ? <p role="status">{message}</p> : null}
    {!bootstrap ? <p><a href="/admin">Open admin dashboard</a></p> : null}
  </section>;
}
