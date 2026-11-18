"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { retailTestTierInitialState, retailTestTierReducer, retailTestTierResponse, retailTestTierSelection } from "@/lib/retail-test-tier-ui.mjs";
import styles from "./retail-test-tier.module.css";

const ENDPOINT = "/api/account/test-tier";
const catalogueName = value => String(value || "NONE").toLowerCase().replaceAll("_", " ");

export default function RetailTestTierSelector() {
  const [state, dispatch] = useReducer(retailTestTierReducer, retailTestTierInitialState);
  const inFlight = useRef(false);
  const { plan, warnings, canApply } = retailTestTierSelection(state);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "load-start" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load your test tiers.");
      dispatch({ type: "loaded", data: retailTestTierResponse(body) });
    } catch (error) {
      dispatch({ type: "load-failed", error: error.name === "AbortError" ? "Loading took too long. Please reload the current tier." : error.message || "Unable to load your test tiers." });
    } finally { clearTimeout(timer); inFlight.current = false; }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function apply(event) {
    event.preventDefault();
    if (!canApply || inFlight.current) return;
    inFlight.current = true;
    const requestedCode = state.selectedCode;
    dispatch({ type: "apply-start" });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ planCode: requestedCode, confirmed: true, expectedRevision: state.data.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The test tier change could not be confirmed.");
      const data = retailTestTierResponse(body);
      if (data.currentPlan?.code !== requestedCode) throw new Error("The saved tier did not match your selection.");
      dispatch({ type: "applied", data });
    } catch (error) {
      const detail = error.name === "AbortError" ? "The change took too long to confirm." : error.message || "The test tier change could not be confirmed.";
      dispatch({ type: "apply-failed", error: `${detail} Your selection is kept. Reload the current tier before trying again.` });
    } finally { clearTimeout(timer); inFlight.current = false; }
  }

  return <section className={styles.card} aria-labelledby="retail-test-tier-title" aria-busy={Boolean(state.busy)} id="retail-test-tier">
    <header className={styles.header}><div><p className={styles.eyebrow}>YOUR RETAIL TEST ACCOUNT</p><h2 id="retail-test-tier-title">Test a Retail tier</h2></div><span className={styles.badge}>Free test · no subscription charge</span></header>
    <p className={styles.intro}>Try different Retail features and allowances, then switch back whenever you need. Your existing streaming hosting budget still applies.</p>
    <div className={styles.current}><span>Currently testing</span><strong>{state.data ? state.data.currentPlan?.name || "Current private test setup" : "Loading…"}</strong>
      <button type="button" className={styles.reload} onClick={load} disabled={Boolean(state.busy)}>{state.busy === "load" ? "Loading…" : "Reload current tier"}</button></div>
    {state.data && <form onSubmit={apply} className={styles.form}>
      <label htmlFor="retail-test-tier-choice">Choose a tier</label>
      <div className={styles.controls}><select id="retail-test-tier-choice" value={state.selectedCode} onChange={event => dispatch({ type: "select", code: event.target.value })} disabled={Boolean(state.busy)} aria-describedby="retail-tier-stream-note">
        {!state.data.currentPlan && <option value="" disabled>Current setup — choose a tier to try</option>}
        {state.data.plans.map(item => <option value={item.code} key={item.code}>{item.name}</option>)}
      </select><button className={styles.primary} disabled={!canApply}>{state.busy === "save" ? "Applying…" : "Use this tier for testing"}</button></div>
      {plan && <div className={styles.preview} aria-label={`${plan.name} test allowances`}>
        <dl className={styles.limits}><div><dt>Shops</dt><dd>{plan.limits.locations}</dd></div><div><dt>Devices</dt><dd>{plan.limits.players}</dd></div><div><dt>Tier storage limit</dt><dd>{plan.limits.storageGb} GB</dd></div><div><dt>Tier audio ceiling</dt><dd>{plan.limits.bitrateKbps} kbps</dd></div></dl>
        <p className={styles.features}>Catalogue: <strong>{catalogueName(plan.catalogueLevel)}</strong> · Commercial uploads: <strong>{plan.promoUploadEnabled ? "Included" : "Not included"}</strong></p>
      </div>}
      {warnings.length > 0 && <div className={styles.warning}><strong>Switching to a smaller allowance keeps your saved data.</strong><ul>{warnings.map(message => <li key={message}>{message}</li>)}</ul></div>}
    </form>}
    <p id="retail-tier-stream-note" className={styles.note}>The live stream keeps its current 128 kbps setting. Digital displays remain off. Choosing a tier does not apply it until you press the button.</p>
    <p className={styles.note}>Private test uploads remain limited to 100 MB and 50 recordings. Catalogue access also follows the existing Focused music permissions: a higher tier does not add music rights. Start and Business do not include the licensed catalogue.</p>
    {state.data?.warnings?.length > 0 && <ul className={styles.warning}>{state.data.warnings.map((message, index) => <li key={index}>{String(message)}</li>)}</ul>}
    {state.error && <p className={styles.error} role="alert">{state.error}</p>}
    {state.message && <p className={styles.success} role="status">{state.message}</p>}
  </section>;
}
