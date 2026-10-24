"use client";

import { useEffect, useRef, useState } from "react";
import { safeRetailPlayoutView, retailMusicRequest, retailStartRequest, retailPlayoutNotice, retailSourceSummary } from "@/lib/retail-stream-playout-ui.mjs";
import styles from "./retail-stream.module.css";

const usd = value => value == null ? "Not yet available" : `US$${value.toFixed(2)}`;

export default function RetailStreamPlayoutPanel({ organisationId }) {
  const [view, setView] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(null);
  const [territory, setTerritory] = useState(""), [genres, setGenres] = useState([]), [accepted, setAccepted] = useState(false);
  const [uncertain, setUncertain] = useState(false), [observedNow, setObservedNow] = useState(() => new Date());
  const [stopAccepted, setStopAccepted] = useState(false);
  const pending = useRef(false), mounted = useRef(true), controller = useRef(null);
  const endpoint = `/api/admin/organisations/${encodeURIComponent(organisationId)}/retail-playout`;

  async function request(action = null) {
    if (pending.current) return;
    if (action === "stop" && stopAccepted !== true) return;
    let input;
    try {
      if (action === "prepare") input = retailMusicRequest({ territory, genreCodes: genres });
      else if (action === "start") input = retailStartRequest(view, accepted);
      else if (action === "stop") input = { action: "stop" };
      if (action && action !== "stop" && uncertain) return;
    } catch (error) { setMessage({ type: "error", text: error.message }); return; }
    pending.current = true; setBusy(true); setMessage(null); setAccepted(false); setStopAccepted(false);
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch(endpoint, { method: action ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : {}) });
      let body;
      try { body = await response.json(); } catch { throw new Error("UNCONFIRMED_STATUS"); }
      if (!response.ok) {
        if (mounted.current) {
          setUncertain(true);
          setMessage({ type: "error", text: retailPlayoutNotice(body?.code) });
        }
        return;
      }
      if (action && (body.accepted !== true || body.action !== action)) throw new Error("UNCONFIRMED_STATUS");
      if (action === "stop" && body.status === "STOP_REQUESTED" && body.readiness === null) {
        if (mounted.current) {
          setUncertain(true);
          setMessage({ type: "success", text: "Stop request accepted. Current source status is unavailable, so disconnection is not yet confirmed. Refresh to check." });
        }
        return;
      }
      const next = safeRetailPlayoutView(body.readiness, organisationId);
      if (mounted.current) {
        setView(next); setObservedNow(new Date()); setUncertain(false);
        setTerritory(next.prepared?.territory || ""); setGenres(next.prepared?.genreCodes || []);
        if (action) setMessage({ type: "success", text: action === "prepare"
          ? "Music selection saved. Retail audio has not been started."
          : action === "start" ? "Start requested. Check the source report and listen separately before treating the stream as verified."
          : "Stop requested. Refresh to check the worker’s latest report." });
      }
    } catch {
      if (mounted.current) {
        setUncertain(true);
        setMessage({ type: "error", text: action
          ? "The result could not be confirmed. Refresh status before another change; the request may already have completed."
          : "Retail status could not be refreshed. The current audio state is unverified; no change was sent." });
      }
    } finally {
      clearTimeout(timeout); pending.current = false; controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    // React's development setup-cleanup-setup must not leave the only initial
    // read aborted while the second setup sees a pending request.
    const initialRead = setTimeout(() => { if (mounted.current) void request(); }, 0);
    // Expire the displayed source evidence without polling or making changes.
    const timer = setInterval(() => setObservedNow(new Date()), 1000);
    return () => { mounted.current = false; clearTimeout(initialRead); controller.current?.abort(); clearInterval(timer); };
  }, [organisationId]);
  const summary = view ? retailSourceSummary(view, observedNow) : null;
  const canEdit = view?.canPrepare === true && !view.enabled && !busy && !uncertain;
  const selectionChanged = Boolean(view?.prepared) && (territory !== view.prepared.territory ||
    JSON.stringify([...genres].sort()) !== JSON.stringify([...view.prepared.genreCodes].sort()));
  const canStart = view?.canStart === true && !busy && !uncertain && !selectionChanged;
  const updateGenre = (code, checked) => {
    setGenres(previous => checked ? [...previous, code] : previous.filter(item => item !== code));
    setAccepted(false); setMessage(null);
  };

  return <section className={styles.card} aria-labelledby="retail-playout-title">
    <p className={styles.eyebrow}>SHARED RETAIL PROGRAMME</p>
    <h2 id="retail-playout-title">From catalogue to your shops</h2>
    <p className={styles.intro}>Choose music once for all shops listening to this subscriber’s stream. Saving a music selection keeps audio off. Starting is a separate owner action, available only after the current plan, music and approved hosting pass their checks.</p>
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy} onClick={() => request()}>{busy ? "Checking…" : "Refresh streaming status"}</button></div>
    {message && <p role={message.type === "error" ? "alert" : "status"} className={message.type === "error" ? styles.error : styles.success}>{message.text}</p>}
    {!view ? <p className={styles.notice}>{busy ? "Loading the saved Retail setup…" : "No verified Retail status is available yet. Refresh to continue."}</p> : <>
      <ol className={styles.steps} aria-label="Retail stream setup progress">
        <li><strong>1 · Connection</strong><span>{view.connectionSaved ? "Centova details saved" : "Save Centova details above"}</span></li>
        <li><strong>2 · Music</strong><span>{view.prepared ? "Music selection saved" : "Choose your programme below"}</span></li>
        <li><strong>3 · Hosting & start</strong><span>{view.enabled ? "Start approved" : view.canStart ? "Ready for owner approval" : "Readiness checks pending"}</span></li>
      </ol>
      <div className={styles.sourceReport} aria-live="polite">
        <strong>{summary.label}</strong><p>{summary.detail}</p>
        {view.observation?.observedAt && <small>Last source report: {new Date(view.observation.observedAt).toLocaleString()} · {summary.fresh ? "fresh" : "not current"}. Source evidence is separate from a listener test.</small>}
      </div>
      {view.blockers.length > 0 && <div className={styles.notice}><strong>Before this stream can start</strong><ul>{[...new Set(view.blockers)].map(reason => <li key={reason}>{retailPlayoutNotice(reason)}</li>)}</ul></div>}
      <form onSubmit={event => { event.preventDefault(); if (canEdit) void request("prepare"); }}>
        <fieldset disabled={!canEdit} className={styles.musicFields}>
          <legend>Music for all shops</legend>
          <label className={styles.countryField}>Shop country<input value={territory} onChange={event => { setTerritory(event.target.value.toUpperCase()); setAccepted(false); }} required maxLength={2} pattern="[A-Za-z]{2}" placeholder="MT" autoComplete="country" aria-describedby="retail-country-help" />
            <small id="retail-country-help">Two-letter country code, for example MT for Malta. This checks existing catalogue permissions; it does not grant new music rights.</small></label>
          <p className={styles.hint}>Leave all genres unticked to use every eligible genre. {view.eligibleTrackCount} recordings currently pass the saved programme’s checks.</p>
          <div className={styles.genreOptions}>{view.availableGenres.map(genre => <label key={genre.code}><input type="checkbox" checked={genres.includes(genre.code)} onChange={event => updateGenre(genre.code, event.target.checked)} />{genre.name}</label>)}</div>
          {genres.filter(code => !view.availableGenres.some(genre => genre.code === code)).map(code => <label key={code} className={styles.confirm}><input type="checkbox" checked onChange={() => setGenres(previous => previous.filter(item => item !== code))} /><span>{code} · no longer available; untick to remove it</span></label>)}
          <div className={styles.actions}><button type="submit" disabled={!canEdit}>Save music selection — audio stays off</button></div>
        </fieldset>
      </form>
      <h3 className={styles.playoutSubheading}>Hosting and approval</h3>
      <dl className={styles.summary}>
        <dt>Output</dt><dd>One programme shared by this subscriber’s shops</dd>
        <dt>Hosting assignment</dt><dd>{view.capacity.assigned ? "Approved capacity assigned" : "Not assigned"}</dd>
        <dt>Output quality</dt><dd>{view.capacity.bitrateKbps ? `${view.capacity.bitrateKbps} kbps` : "Not yet confirmed"}</dd>
        <dt>Estimated monthly running cost</dt><dd>{usd(view.capacity.estimatedMonthlyUsd)}</dd>
        <dt>Approved monthly allowance</dt><dd>{usd(view.capacity.monthlyBudgetUsd)}</dd>
      </dl>
      <p className={styles.hint}>The allowance comes from the approved hosting assignment. These controls cannot purchase a service, increase a plan limit or use Test Radio’s allowance. A private test plan may allow preparation without permitting playback.</p>
      {selectionChanged && <p className={styles.notice}>Save the changed music selection before starting this programme.</p>}
      {!view.enabled && <>
        <label className={styles.confirm}><input type="checkbox" checked={accepted} disabled={!canStart} onChange={event => setAccepted(event.target.checked)} /><span>I approve starting this Retail programme within the displayed monthly allowance. Anyone with the Centova listener address may be able to listen.</span></label>
        <div className={styles.actions}><button type="button" disabled={!canStart || !accepted} onClick={() => request("start")}>Start this Retail stream</button></div>
      </>}
      <p className={styles.footnote}>Test Radio, public registration, shop and display allowances, and other subscribers’ streams are not changed by this Retail setup.</p>
    </>}
    <div aria-labelledby="retail-stop-title">
      <h3 id="retail-stop-title" className={styles.playoutSubheading}>Stop this Retail programme</h3>
      <p className={styles.hint}>You can request a stop even when streaming status cannot be loaded. A successful request does not confirm disconnection until the worker reports it.</p>
      <label className={styles.confirm}><input type="checkbox" checked={stopAccepted} disabled={busy} onChange={event => setStopAccepted(event.target.checked)} /><span>I confirm stopping only this Retail stream.</span></label>
      <div className={styles.actions}><button type="button" className={styles.secondary} disabled={busy || !stopAccepted} onClick={() => request("stop")}>Stop this Retail stream</button></div>
    </div>
  </section>;
}
