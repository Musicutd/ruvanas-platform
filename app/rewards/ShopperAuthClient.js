"use client";

import { useEffect, useRef, useState } from "react";
import { acceptShopperInvitationSchema, canonicalEmailSchema, shopperPasswordSchema } from "@/lib/retail-rewards/shopper-auth-contracts.mjs";
import styles from "./shopper-auth.module.css";

const defaultTransport = (path, options) => fetch(path, options);
const messages = {
  AUTH_FAILED: "We couldn’t sign you in. Check your shopper email and password, or contact the person who invited you.",
  INVITATION_UNAVAILABLE: "This invitation cannot be used. It may have expired or already been accepted. Contact the person who invited you.",
  RATE_LIMITED: "There have been too many attempts. Please wait before trying again.",
  FEATURE_DISABLED: "Private shopper sign-in is not available right now.",
  INVALID_REQUEST: "Please check the information you entered and try again."
};
const unavailable = "We couldn’t complete this request. Please try again shortly.";

export default function ShopperAuthClient({ mode = "login", transport = defaultTransport, onSuccess, previewOnly = false }) {
  const invitation = mode === "invitation";
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef(null);
  const mounted = useRef(true);
  const errorRef = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || complete) return;
    setError("");
    if (!shopperPasswordSchema.safeParse(password).success) {
      setError("Use a password with at least 15 characters and no more than 72 UTF-8 bytes. Spaces are allowed; some characters use more than one byte."); return;
    }
    let body;
    if (invitation) {
      if (password !== confirmation) { setError("Your passwords do not match. Enter the same password in both fields."); return; }
      const parsed = acceptShopperInvitationSchema.safeParse({ token, password, ...(displayName.trim() ? { displayName: displayName.trim() } : {}) });
      if (!parsed.success) { setError("Check your invitation code and optional display name. Paste the complete 64-character invitation code without spaces."); return; }
      body = parsed.data;
    } else {
      const parsedEmail = canonicalEmailSchema.safeParse(email);
      if (!parsedEmail.success) { setError("Enter the email address associated with your shopper invitation."); return; }
      body = { email: parsedEmail.data, password };
    }
    inFlight.current = true; setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await transport(`/api/rewards/auth/${invitation ? "invitation" : "login"}`, {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const result = typeof response?.json === "function" ? await response.json() : response;
      if (!mounted.current) return;
      if (abort.signal.aborted) throw new Error("TIMEOUT");
      // Never display arbitrary server text or a server-provided destination.
      if (result?.ok !== true || response?.ok === false) { setError(messages[result?.code] || unavailable); return; }
      setComplete(true);
      if (onSuccess) onSuccess({ next: "/rewards" });
      else window.location.replace("/rewards");
    } catch (problem) {
      if (mounted.current) setError(problem.name === "AbortError" || problem.message === "TIMEOUT" ? "The request took too long. Please try again." : unavailable);
    } finally {
      clearTimeout(timeout); inFlight.current = false; controller.current = null;
      // Secrets remain in this form only while it is being completed. Never
      // put them in a URL, browser storage, telemetry or a success callback.
      if (mounted.current) { setPassword(""); setConfirmation(""); setToken(""); setBusy(false); }
    }
  }

  return <main className={styles.page}>
    {previewOnly && <div className={styles.preview}><strong>LOCAL SHOPPER PREVIEW</strong> · Sample credentials only · Nothing is sent to Ruvanas</div>}
    <header className={styles.header}><div className={styles.headerInner}><a href="/rewards" className={styles.brand}><span>RUVANAS</span><strong>Rewards</strong></a><span className={styles.badge}>Shopper</span></div></header>
    <div className={styles.layout}>
      <section className={styles.intro}><p className={styles.eyebrow}>YOUR PRIVATE SHOPPER ACCESS</p><h1>{invitation ? "An invitation to discover more." : "Welcome back."}</h1><p>{invitation ? "Accept your invitation, then explore shops and their offers in one place." : "Sign in to explore participating shops and compare their offers."}</p><div className={styles.steps}><span>Choose a category</span><b aria-hidden="true">→</b><span>Find a shop</span><b aria-hidden="true">→</b><span>Read the offers</span></div><aside className={styles.notice}><strong>Shopper access is separate</strong><p>Use your shopper credentials here. A business or administrator account does not sign you in to Rewards.</p></aside></section>
      <section className={styles.card} aria-labelledby="shopper-auth-heading"><p className={styles.eyebrow}>{invitation ? "BY PRIVATE INVITATION" : "SHOPPER SIGN-IN"}</p><h2 id="shopper-auth-heading">{invitation ? "Accept your invitation" : "Sign in to Rewards"}</h2><p className={styles.cardLead}>{invitation ? "Use the code shared with you. Your invitation already identifies the email address for this shopper account." : "Already accepted your invitation? Enter your shopper email and password."}</p>
        <form onSubmit={submit} noValidate>
          {invitation ? <>
            <label className={styles.field}>Invitation code<input name="invitationCode" type="password" value={token} onChange={event => setToken(event.target.value)} maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy || complete} aria-describedby="invitation-help" /></label><p id="invitation-help" className={styles.help}>Paste the complete code privately into this field. Do not add it to the page address.</p>
            <label className={styles.field}>Your name <span className={styles.optional}>(optional)</span><input name="displayName" type="text" value={displayName} onChange={event => setDisplayName(event.target.value)} maxLength={80} autoComplete="nickname" disabled={busy || complete} /></label>
          </> : <label className={styles.field}>Shopper email<input name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy || complete} /></label>}
          <label className={styles.field}>{invitation ? "Create a password" : "Password"}<input name="password" type="password" autoComplete={invitation ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} disabled={busy || complete} aria-describedby={invitation ? "password-help" : undefined} /></label>
          {invitation && <><p id="password-help" className={styles.help}>At least 15 characters, up to 72 UTF-8 bytes. A memorable phrase works well. Some characters use more than one byte.</p><label className={styles.field}>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy || complete} /></label></>}
          {error && <p className={styles.error} ref={errorRef} role="alert" tabIndex={-1}>{error}</p>}
          {complete && <p className={styles.success} role="status">Signed in. Opening Rewards…</p>}
          <button className={styles.submit} type="submit" disabled={busy || complete}>{busy ? "Please wait…" : invitation ? "Accept invitation and sign in" : "Sign in"}</button>
        </form>
        <p className={styles.switchLink}>{invitation ? <>Already accepted? <a href="/rewards/sign-in">Sign in</a></> : <>Have an invitation code? <a href="/rewards/accept-invitation">Accept your invitation</a></>}</p>
        <div className={styles.privateNote}><strong>Private access only</strong><p>Public registration is closed. If you need access or help signing in, contact the person who invited you.</p></div>
      </section>
    </div>
    <footer className={styles.footer}>Coupon claiming and shop redemption depend on your current access and the offer’s terms. Accepting an invitation does not purchase a membership or verify email ownership.</footer>
  </main>;
}
