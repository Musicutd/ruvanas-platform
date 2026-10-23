"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TEST_RADIO_PLANNER_STATION_ID, testRadioWeeklyEmptyItem, testRadioWeeklyForm, testRadioWeeklySaveBody,
  testRadioWeeklyFormSnapshot, testRadioWeeklyApprovalBody, testRadioWeeklyDays } from "@/lib/test-radio-weekly-planner-ui.mjs";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const button = { minHeight: 44, padding: "10px 14px", borderRadius: 8, border: "1px solid #846315", fontWeight: 700, cursor: "pointer" };
const field = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const input = { minHeight: 44, border: "1px solid #b7c7d8", borderRadius: 6, padding: 8, color: "#14283d", background: "white", maxWidth: "100%" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(210px, 100%), 1fr))", gap: 14 };

export function TestRadioWeeklyReview({ state }) {
  const days = testRadioWeeklyDays(state);
  const sourceName = id => state.sources?.find(source => source.id === id)?.name || "Saved playlist";
  if (!days.length) return <p role="alert">The saved weekly preview is unavailable. Refresh and review it before approving any changes.</p>;
  return <section aria-labelledby="test-radio-weekly-review-title" style={{ marginTop: 20 }}>
    <h3 id="test-radio-weekly-review-title">Review saved version {state.draft.version}</h3>
    <p><strong>{state.schedule.name} · {state.schedule.timezone}</strong></p>
    <p>This is a preview of the saved version, not proof of live audio. Approving this version allows Test Radio’s worker to use its scheduled music. Later draft edits do not go on air automatically.</p>
    <p style={{ fontSize: 13 }}>The cards show the next seven days. Approval checks conflicts over the next 31 days; later one-off programmes remain in the saved form above and are not shown in these cards.</p>
    {(state.draft.preview.warnings || []).map((warning, index) => <p role="note" key={index} style={{ padding: 10, background: "#fff3cf" }}>{warning}</p>)}
    <div style={{ display: "grid", gap: 10 }}>{days.map(day => <section key={day.date} style={{ border: "1px solid #c3ced7", padding: 14, borderRadius: 8 }}>
      <h4 style={{ margin: "0 0 10px" }}>{day.label}</h4>
      {day.items.length ? <ol style={{ margin: 0, paddingLeft: 22 }}>{day.items.map((item, index) => <li key={`${item.sourceId}:${item.startsAt}:${index}`} style={{ marginBottom: 10 }}>
        <strong>{item.startLabel}–{item.endLabel}</strong> · {item.label}<br />
        {sourceName(item.sourceId)} · overlap priority {item.priority}
      </li>)}</ol> : <p style={{ margin: 0 }}>No scheduled programme. Continuous random AutoDJ continues while enabled and eligible music is available.</p>}
    </section>)}</div>
  </section>;
}

export default function TestRadioWeeklyPlanner({ stationId }) {
  const [state, setState] = useState(null), [form, setForm] = useState(() => testRadioWeeklyForm(null));
  const [baseline, setBaseline] = useState(() => testRadioWeeklyFormSnapshot(testRadioWeeklyForm(null)));
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [reviewHash, setReviewHash] = useState(null), [reviewOpen, setReviewOpen] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const sequence = useRef(0), abortRead = useRef(null), actionPending = useRef(false);
  const endpoint = `/api/admin/stations/${encodeURIComponent(stationId)}/continuous-schedule`;
  const unsaved = testRadioWeeklyFormSnapshot(form) !== baseline;
  const clearReview = () => { setReviewHash(null); setReviewOpen(false); setAcknowledged(false); };
  const adopt = useCallback((body, channelId = "") => {
    if (body.stationId !== TEST_RADIO_PLANNER_STATION_ID) throw new Error("Only Test Radio can use these controls.");
    const next = testRadioWeeklyForm(body, channelId);
    setState(body); setForm(next); setBaseline(testRadioWeeklyFormSnapshot(next)); setReviewHash(null); setReviewOpen(false); setAcknowledged(false);
  }, []);
  const load = useCallback(async (channelId = "") => {
    if (stationId !== TEST_RADIO_PLANNER_STATION_ID || actionPending.current) return;
    const read = ++sequence.current;
    abortRead.current?.abort(); const controller = new AbortController(); abortRead.current = controller;
    setBusy("load"); setError("");
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${endpoint}${channelId ? `?channelId=${encodeURIComponent(channelId)}` : ""}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The Test Radio weekly plan could not be loaded.");
      if (read === sequence.current) adopt(body, channelId);
    } catch (caught) {
      if (read === sequence.current) { setError(caught.name === "AbortError" ? "Loading timed out. Refresh the weekly plan before making changes." : caught.message); setReviewHash(null); setReviewOpen(false); setAcknowledged(false); }
    } finally { clearTimeout(timeout); if (read === sequence.current) setBusy(""); }
  }, [stationId, endpoint, adopt]);
  useEffect(() => { void load(); return () => { sequence.current += 1; abortRead.current?.abort(); }; }, [load]);

  async function command(action, event) {
    event?.preventDefault();
    if (actionPending.current || stationId !== TEST_RADIO_PLANNER_STATION_ID) return;
    let request;
    try {
      request = action === "save" ? testRadioWeeklySaveBody(form) : action === "approve"
        ? testRadioWeeklyApprovalBody({ state, form, reviewHash, reviewed: reviewOpen, overridesAcknowledged: acknowledged }) : { action: "disable" };
      if (!request) throw new Error("Review the saved version and confirm the exact-start handovers before approving.");
    } catch (caught) { setError(caught.message); return; }
    actionPending.current = true; sequence.current += 1; abortRead.current?.abort();
    setBusy(action); setError(""); setMessage(""); clearReview();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(request) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The schedule command could not be confirmed. Refresh before retrying.");
      if (body.stationId !== TEST_RADIO_PLANNER_STATION_ID) throw new Error("The response did not match Test Radio. Refresh before retrying.");
      if (action === "disable" && state) setState(body); else adopt(body, form.channelId);
      setMessage(action === "save" ? "A new draft version was saved. It is not approved for broadcasting. Review the saved week next." : action === "approve"
        ? "This saved version is approved for Test Radio. The worker will apply its scheduled starts; check AutoDJ status for actual audio." : "Scheduled takeovers are disabled. Continuous random AutoDJ remains enabled or disabled as before; this does not stop its stream.");
    } catch (caught) { setError(caught.name === "AbortError" ? "The command timed out and its result is uncertain. Refresh before retrying. Disable scheduled takeovers remains available." : caught.message); }
    finally { clearTimeout(timeout); actionPending.current = false; setBusy(""); }
  }
  function changeItem(index, key, value) {
    clearReview(); setMessage("");
    setForm(previous => ({ ...previous, items: previous.items.map((item, position) => position === index ? { ...item, [key]: value } : item) }));
  }
  function refresh(channelId = form.channelId) {
    if (unsaved && !window.confirm("Discard these unsaved planner changes and reload the saved version?")) return;
    setMessage(""); clearReview(); void load(channelId);
  }
  const approve = testRadioWeeklyApprovalBody({ state, form, reviewHash, reviewed: reviewOpen, overridesAcknowledged: acknowledged });
  if (stationId !== TEST_RADIO_PLANNER_STATION_ID) return null;
  return <section aria-labelledby="test-radio-weekly-title" style={{ margin: "28px 0", padding: 24, border: "1px solid #b7c7d8", borderRadius: 12, background: "#f7fafc", color: "#14283d" }}>
    <p style={{ margin: "0 0 8px", color: "#816000", fontWeight: 800 }}>OWNER CONTROL · TEST RADIO ONLY</p>
    <h2 id="test-radio-weekly-title" style={{ marginTop: 0 }}>Weekly planner and AutoDJ handovers</h2>
    <p>Random AutoDJ fills the gaps. The source switches to an approved programme exactly at its scheduled time, cutting the current song if needed. At the programme’s end, random AutoDJ returns automatically. Listeners may hear the change a few seconds later because of stream buffering.</p>
    <p><strong>Save draft → review saved week → approve for Test Radio.</strong> Saving or previewing never puts a new version on air. This separate owner approval does not unlock publishing for your tester account or change other channels.</p>
    <p style={{ fontSize: 13 }}>These controls use Test Radio’s saved weekly plans. The subscriber <a href={`/dashboard/radio/schedule/${TEST_RADIO_PLANNER_STATION_ID}`}>weekly planner</a> remains subject to its existing draft-only access. No new paid service is created; the existing US$15 monthly allowance still applies.</p>
    {error && <p role="alert" style={{ padding: 12, background: "#fff0f0", color: "#9f1825" }}>{error}</p>}
    {message && <p role="status" style={{ padding: 12, background: "#e6f4e9" }}>{message}</p>}
    {!state && !error && <p role="status">Loading Test Radio’s saved plans and playlists…</p>}
    {state && <>
      <p role="status"><strong>{state.approved?.enabled ? `Approved for Test Radio: version ${state.approved.version}` : "No weekly version is approved for Test Radio."}</strong> {state.approved?.enabled ? `Time zone: ${state.approved.timezone}. New drafts do not replace it until separately approved.` : "Random AutoDJ continues whenever it is enabled."}</p>
      {state.approved?.enabled && state.approved.effectiveAt && <p>Approved version effective from {new Date(state.approved.effectiveAt).toLocaleString("en-GB", { timeZone: state.approved.timezone })} · {state.approved.timezone}. Approval includes preparation time; it does not cut into a programme that is already in progress.</p>}
      {(state.warnings || []).map((warning, index) => <p key={index} role="note" style={{ padding: 10, background: "#fff3cf" }}>{warning}</p>)}
    </>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
      <button type="button" style={button} disabled={Boolean(busy)} onClick={() => refresh()}>Refresh saved plan</button>
      <button type="button" style={{ ...button, background: "#fff3cf" }} disabled={Boolean(busy)} onClick={() => command("disable")}>Disable scheduled takeovers — keep AutoDJ</button>
    </div>
    {state && <form onSubmit={event => command("save", event)}>
      <label style={{ ...field, marginBottom: 14 }}>Test Radio channel<select required disabled={Boolean(busy)} value={form.channelId} onChange={event => refresh(event.target.value)} style={input}><option value="">Choose channel</option>{(state.channels || []).map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      <fieldset disabled={Boolean(busy) || state.canEdit !== true} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 800, marginBottom: 12 }}>{state.draft ? `Prepare the next draft after version ${state.draft.version}` : "Create your first weekly draft"}</legend>
        <div style={grid}>
          <label style={field}>Plan name<input required maxLength={120} value={form.name} onChange={event => { clearReview(); setForm({ ...form, name: event.target.value }); }} style={input} /></label>
          <label style={field}>Planner time zone<input required value={form.timezone} readOnly={Boolean(state.schedule)} onChange={event => { clearReview(); setForm({ ...form, timezone: event.target.value }); }} style={input} /></label>
        </div>
        <p style={{ fontSize: 13 }}>All programme times use {form.timezone}, not your computer’s clock. The time zone is fixed after the plan is created. Times missing or repeated during clock changes must be reviewed.</p>
        {!state.sources?.length && <p role="note">No saved music playlist is available. Save a Test Radio playlist before preparing a programme.</p>}
        <div style={{ display: "grid", gap: 14 }}>{form.items.map((item, index) => <fieldset key={index} style={{ border: "1px solid #c3ced7", borderRadius: 8, padding: 14, minWidth: 0 }}>
          <legend style={{ fontWeight: 700 }}>Programme {index + 1}</legend>
          <div style={grid}>
            <label style={field}>Programme name<input required maxLength={160} value={item.label} onChange={event => changeItem(index, "label", event.target.value)} style={input} /></label>
            <label style={field}>Saved music playlist<select required value={item.sourceId} onChange={event => changeItem(index, "sourceId", event.target.value)} style={input}><option value="">Choose playlist</option>{(state.sources || []).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
            <label style={field}>Repeat<select value={item.recurrence} onChange={event => changeItem(index, "recurrence", event.target.value)} style={input}><option value="WEEKLY">Every week</option><option value="ONE_OFF">One time only</option></select></label>
            {item.recurrence === "WEEKLY" ? <>
              <label style={field}>Day<select value={item.weekday} onChange={event => changeItem(index, "weekday", Number(event.target.value))} style={input}>{DAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label>
              <label style={field}>Start time<input required type="time" value={item.startTime} onChange={event => changeItem(index, "startTime", event.target.value)} style={input} /></label>
            </> : <label style={field}>Start date and time<input required type="datetime-local" value={item.startsAt} onChange={event => changeItem(index, "startsAt", event.target.value)} style={input} /></label>}
            <label style={field}>Length in minutes<input required type="number" min="1" max="1440" value={item.durationMinutes} onChange={event => changeItem(index, "durationMinutes", event.target.value)} style={input} /></label>
          </div>
          <details style={{ marginTop: 12 }}><summary>Advanced: overlap priority</summary><p>A higher number wins during overlaps. Equal-priority overlaps block approval. Review any priority overrides before approving.</p><label style={field}>Priority<input type="number" min="0" max="100" value={item.priority} onChange={event => changeItem(index, "priority", event.target.value)} style={input} /></label></details>
          <button type="button" style={{ ...button, marginTop: 12 }} disabled={form.items.length === 1} onClick={() => { clearReview(); setForm({ ...form, items: form.items.filter((_, position) => position !== index) }); }}>Remove programme</button>
        </fieldset>)}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
          <button type="button" style={button} disabled={form.items.length >= 200} onClick={() => { clearReview(); setForm({ ...form, items: [...form.items, testRadioWeeklyEmptyItem()] }); }}>Add programme</button>
          <button type="submit" style={{ ...button, background: "#f4b942" }} disabled={!form.channelId || !state.sources?.length}>{busy === "save" ? "Saving…" : "Save draft — no on-air change"}</button>
        </div>
      </fieldset>
      {state.canEdit !== true && <p role="note">Editing is unavailable. Check the channel, existing service permission and approved playlist sources.</p>}
    </form>}
    {state?.draft && <div style={{ borderTop: "1px solid #c3ced7", paddingTop: 18, marginTop: 20 }}>
      <p role="status">{unsaved ? "Unsaved changes — save a new draft before reviewing or approving." : `Saved version ${state.draft.version} is loaded. It does not affect the stream until approved.`}</p>
      <button type="button" style={button} disabled={Boolean(busy) || unsaved || Boolean(error) || !state.draft.preview} onClick={() => { setReviewHash(state.draft.reviewHash); setReviewOpen(true); setAcknowledged(false); }}>Review saved week</button>
      {reviewOpen && <>
        <TestRadioWeeklyReview state={state} />
        <label style={{ display: "block", margin: "18px 0", lineHeight: 1.6 }}><input type="checkbox" checked={acknowledged} disabled={Boolean(busy)} onChange={event => setAcknowledged(event.target.checked)} /> I reviewed this saved week, its time zone and any overlap priorities. I approve exact starts that can cut the current song, followed by automatic return to random AutoDJ.</label>
        <button type="button" style={{ ...button, background: "#f4b942" }} disabled={Boolean(busy) || Boolean(error) || !approve || !testRadioWeeklyDays(state).length} onClick={() => command("approve")}>Approve version {state.draft.version} for Test Radio</button>
      </>}
    </div>}
  </section>;
}
