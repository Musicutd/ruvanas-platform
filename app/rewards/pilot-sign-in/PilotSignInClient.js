"use client";

import { useEffect, useRef, useState } from "react";
import { canonicalEmailSchema } from "@/lib/retail-rewards/shopper-auth-contracts.mjs";
import { rewardIdSchema } from "@/lib/retail-rewards/contracts.mjs";
import { pilotLoginDestination, pilotLoginMessage } from "@/lib/retail-rewards/pilot-login-ui.mjs";
import styles from "../shopper-auth.module.css";

const defaultTransport = (path, options) => fetch(path, options);

export default function PilotSignInClient({ transport = defaultTransport, onSuccess, previewOnly = false }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [organisationId, setOrganisationId] = useState("");
  const [busy, setBusy] = useState(false), [complete, setComplete] = useState(false), [error, setError] = useState("");
  const mounted = useRef(true), inFlight = useRef(false), controller = useRef(null), errorRef = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event) {
    event.preventDefault();
    if (inFlight.current || complete) return;
    setError("");
    const canonicalEmail = canonicalEmailSchema.safeParse(email), workspace = organisationId.trim();
    if (!canonicalEmail.success || !password || new TextEncoder().encode(password).byteLength > 72 || password.includes("\0") ||
      !password.isWellFormed() || (workspace && !rewardIdSchema.safeParse(workspace).success)) {
      setError("Enter your business email and password. If you enter a workspace ID, use the exact ID supplied by the Super Admin."); return;
    }
    const body = { email: canonicalEmail.data, password, ...(workspace ? { organisationId: workspace } : {}) };
    inFlight.current = true; setBusy(true);
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await transport("/api/retail-rewards/pilot-login", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      const result = typeof response?.json === "function" ? await response.json() : response;
      if (!mounted.current) return;
      if (abort.signal.aborted) throw new Error("TIMEOUT");
      const landing = pilotLoginDestination(result);
      if (response?.ok === false || !landing) { setError(pilotLoginMessage(result?.code)); return; }
      setComplete(true);
      if (onSuccess) onSuccess({ next: landing });
      else window.location.replace(landing);
    } catch (problem) {
      if (mounted.current) setError(problem.name === "AbortError" || problem.message === "TIMEOUT"
        ? "Sign-in took too long. Please try again." : pilotLoginMessage());
    } finally {
      clearTimeout(timeout); inFlight.current = false; controller.current = null;
      if (mounted.current) { setPassword(""); setBusy(false); }
    }
  }

  return <main className={styles.page}>
    {previewOnly && <div className={styles.preview}><strong>LOCAL PILOT PREVIEW</strong> · Sample credentials only · Nothing is sent to Ruvanas</div>}
    <header className={styles.header}><div className={styles.headerInner}><span className={styles.brand}><span>RUVANAS</span><strong>Rewards</strong></span><span className={styles.badge}>Private pilot</span></div></header>
    <div className={styles.layout}>
      <section className={styles.intro}><p className={styles.eyebrow}>YOUR OWN ACCOUNT. YOUR ASSIGNED ROLE.</p><h1>Welcome to the Rewards pilot.</h1>
        <p>Super Admins, Client Admins and shop staff use their existing business accounts here. Access is limited to the approved pilot workspaces and permissions.</p>
        <aside className={styles.notice}><strong>Shopping with coupons?</strong><p>Shopper accounts are separate. <a href="/rewards/sign-in">Sign in as a shopper</a>, or <a href="/rewards/accept-invitation">accept your shopper invitation</a>.</p></aside>
      </section>
      <section className={styles.card} aria-labelledby="pilot-login-heading"><p className={styles.eyebrow}>BUSINESS & ADMINISTRATOR SIGN-IN</p><h2 id="pilot-login-heading">Sign in to your pilot</h2>
        <p className={styles.cardLead}>Use the account already approved for this pilot. This form does not create an account or change your role.</p>
        <form onSubmit={submit} noValidate>
          <label className={styles.field}>Business email<input name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy || complete} /></label>
          <label className={styles.field}>Password<input name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy || complete} /></label>
          <details style={{ marginTop: 20 }}><summary>More than one pilot workspace?</summary>
            <label className={styles.field}>Workspace ID <span className={styles.optional}>(optional)</span><input name="organisationId" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={191} value={organisationId} onChange={event => setOrganisationId(event.target.value)} disabled={busy || complete} aria-describedby="pilot-workspace-help" /></label>
            <p className={styles.help} id="pilot-workspace-help">Leave this blank for a single pilot workspace. If you belong to several, enter the workspace ID supplied by your Super Admin.</p>
          </details>
          {error && <p className={styles.error} ref={errorRef} role="alert" tabIndex={-1}>{error}</p>}
          {complete && <p className={styles.success} role="status">Signed in. Opening your Rewards workspace…</p>}
          <button className={styles.submit} type="submit" disabled={busy || complete}>{busy ? "Signing in…" : "Sign in to pilot"}</button>
        </form>
        <p className={styles.switchLink}>Using coupons? <a href="/rewards/sign-in">Shopper sign-in</a></p>
        <div className={styles.privateNote}><strong>Private access only</strong><p>Public registration remains closed. Contact the Super Admin if your existing account has not been assigned to the pilot.</p></div>
      </section>
    </div>
    <footer className={styles.footer}>Pilot access does not enable streaming, purchase a subscription or grant access to other organisations.</footer>
  </main>;
}
