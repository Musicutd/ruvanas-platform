"use client";

import { useCallback, useEffect, useState } from "react";
import { onlineStudioGuideState } from "@/lib/studio-online-guide.mjs";
import styles from "./studio-pro.module.css";

export default function OnlineStudioGuideClient({ enabled, onOpenWorkspace }) {
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const response = await fetch("/api/studio/playout", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Studio setup could not be loaded.");
      setWorkspace(body);
      setError("");
    } catch (cause) { setError(cause.message); }
    finally { setLoading(false); }
  }, [enabled]);
  useEffect(() => { refresh(); }, [refresh]);

  const state = onlineStudioGuideState(workspace);
  return <section className={styles.guide} aria-label="Online Radio Studio setup">
    <div className={styles.guideHeader}>
      <div><p className={styles.eyebrow}>ONLINE RADIO · SIMPLE START</p><h2>Get Studio ready for your station</h2><p className={styles.muted}>Your current AutoDJ can continue playing. The Studio queue is preparation only until its output is connected and heard through a verified listener.</p></div>
      {enabled ? <button type="button" className={styles.secondary} onClick={refresh} disabled={loading}>{loading ? "Checking…" : "Refresh status"}</button> : null}
    </div>
    {!enabled ? <p className={styles.warning}>Studio Basic is available on this tier. Manual broadcast preparation requires Studio Pro (Online Radio Tiers 3–5).</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <ol className={styles.guideSteps}>
      <li className={styles.guideStep}><span className={styles.guideNumber}>1</span><div><h3>Radio channel and backup music</h3><p>{!workspace ? "Checking your channel…" : !state.channel ? "No Online Radio station channel is ready. Ruvanas must prepare one first." : state.fallbackReady ? `${state.channel.name} has an active AutoDJ fallback.` : `${state.channel.name} needs an active AutoDJ fallback.`}</p><a className={styles.secondary} href={state.channel ? "/dashboard/programming#workspace-schedule" : "/dashboard/radio"}>{state.channel ? "Open Continuous AutoDJ" : "Open Online Radio setup"}</a></div><strong className={styles.status}>{!workspace ? "CHECKING" : state.fallbackReady ? "READY" : "NEEDS SETUP"}</strong></li>
      <li className={styles.guideStep}><span className={styles.guideNumber}>2</span><div><h3>Prepare your Studio audio</h3><p>{!workspace ? "Checking your queue…" : !state.session ? "Create a protected playout session for this station, then choose approved audio." : state.readyItemCount ? `${state.readyItemCount} rights-ready item${state.readyItemCount === 1 ? "" : "s"} prepared. This is not on-air playback.` : "Your session is ready; add an approved item to its future queue."}</p><button type="button" className={styles.secondary} onClick={() => onOpenWorkspace("playout")} disabled={!enabled}>Open Manual Playout</button></div><strong className={styles.status}>{!workspace ? "CHECKING" : state.readyItemCount ? "PREPARED" : "TO DO"}</strong></li>
      <li className={styles.guideStep}><span className={styles.guideNumber}>3</span><div><h3>Connect and hear the Studio output</h3><p>{state.encoderConnected ? "Encoder connection reported. An independent listener audio check is still required before calling this live." : "Studio output is not connected to a verified encoder yet. Ruvanas must connect and verify it before use; do not switch off your current AutoDJ."}</p><button type="button" className={styles.secondary} onClick={() => onOpenWorkspace("console")} disabled={!enabled}>View Broadcast Console</button></div><strong className={styles.status}>{state.listenerVerified ? "VERIFIED" : "NOT LIVE"}</strong></li>
    </ol>
    <p className={styles.guideSummary} role="status">{!workspace ? "Checking the next step…" : state.nextStep === "CHANNEL" ? "Next: prepare the station channel and keep AutoDJ as the backup." : state.nextStep === "QUEUE" ? "Next: prepare an approved Studio item. Listeners still hear the existing AutoDJ." : "Your preparation is done. Ruvanas must connect and verify the isolated Studio output before a live handover."}</p>
  </section>;
}
