"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./pilot-business-shell.module.css";

const defaultTransport = (path, options) => fetch(path, options);
const failureMessage = "Sign-out could not be confirmed. Your session may still be active. Please try again.";

export async function requestPilotSignOut(signal, transport = defaultTransport) {
  if (signal.aborted) throw new Error("PILOT_SIGN_OUT_UNCONFIRMED");
  const response = await transport("/api/auth/logout", {
    method: "POST", mode: "same-origin", credentials: "same-origin", cache: "no-store",
    redirect: "manual", signal, headers: { "Content-Type": "application/json" }, body: "{}"
  });
  // The existing endpoint clears the business session and returns 303. With
  // manual redirects, browsers expose only an opaque redirect, not Location.
  // Do not follow server-provided destinations or treat an error as sign-out.
  if (signal.aborted || response?.type !== "opaqueredirect" || response.status !== 0)
    throw new Error("PILOT_SIGN_OUT_UNCONFIRMED");
}

export default function PilotSignOutButton() {
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false), [error, setError] = useState("");
  const mounted = useRef(false), pending = useRef(false), finished = useRef(false), active = useRef(null), errorRef = useRef(null);
  useEffect(() => {
    mounted.current = true; setReady(true);
    return () => { mounted.current = false; active.current?.controller.abort(); clearTimeout(active.current?.timer); };
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function signOut() {
    if (!ready || !mounted.current || pending.current || finished.current) return;
    pending.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    const request = { controller, timer: setTimeout(() => controller.abort(), 15_000) }; active.current = request;
    try {
      await requestPilotSignOut(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      finished.current = true; setComplete(true);
      window.location.replace("/rewards/pilot-sign-in");
    } catch {
      if (mounted.current) setError(failureMessage);
    } finally {
      clearTimeout(request.timer); pending.current = false;
      if (active.current === request) active.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return <div className={styles.signOutControl}>
    <button type="button" onClick={signOut} disabled={!ready || busy || complete}>{busy ? "Signing out…" : "Sign out"}</button>
    {error && <p className={styles.signOutError} role="alert" ref={errorRef} tabIndex={-1}>{error}</p>}
    {complete && <p className={styles.signOutStatus} role="status">Signed out. Opening sign-in…</p>}
  </div>;
}
