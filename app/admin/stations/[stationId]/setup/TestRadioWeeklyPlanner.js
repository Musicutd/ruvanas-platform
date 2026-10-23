"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TEST_RADIO_PLANNER_STATION_ID, testRadioWeeklyEmptyItem, testRadioWeeklyForm, testRadioWeeklySaveBody,
  testRadioWeeklyFormSnapshot, testRadioWeeklyApprovalBody, testRadioWeeklyDays } from "@/lib/test-radio-weekly-planner-ui.mjs";
import { deskRecipeProgramme, mergeDeskRecipeSources } from "@/lib/test-radio-playlist-desk-ui.mjs";
import TestRadioPlaylistDesk from "./TestRadioPlaylistDesk";
import styles from "./test-radio-planner.module.css";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function TestRadioWeeklyReview({ state }) {
  const [view, setView] = useState("cards");
  const days = testRadioWeeklyDays(state);
  const sourceName = id => state.sources?.find(source => source.id === id)?.name || "Saved playlist";
  if (!days.length) return <p role="alert">The saved weekly preview is unavailable. Refresh and review it before approving any changes.</p>;
  return <section aria-labelledby="test-radio-weekly-review-title" className={styles.review}>
    <h3 id="test-radio-weekly-review-title">Review saved version {state.draft.version}</h3>
    <p><strong>{state.schedule.name} · {state.schedule.timezone}</strong></p>
    <p>This is a preview of the saved version, not proof of live audio. Approving this version allows Test Radio’s worker to use its scheduled music. Later draft edits do not go on air automatically.</p>
    <p style={{ fontSize: 13 }}>The cards show the next seven days. Approval checks conflicts over the next 31 days; later one-off programmes remain in the saved form above and are not shown in these cards.</p>
    {(state.draft.preview.warnings || []).map((warning, index) => <p role="note" key={index} className={styles.notice}>{warning}</p>)}
    <div className={styles.toolbar} role="group" aria-label="Saved week view"><button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>Week cards</button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>Agenda list</button></div>
    <div className={view === "cards" ? styles.weekCards : styles.formStack}>{days.map(day => <section key={day.date} className={styles.dayCard}>
      <h4>{day.label}</h4>
      {day.items.length ? <ol>{day.items.map((item, index) => <li key={`${item.sourceId}:${item.startsAt}:${index}`}>
        <strong>{item.startLabel}–{item.endLabel}</strong> · {item.label}<br />
        {sourceName(item.sourceId)} · overlap priority {item.priority}
      </li>)}</ol> : <p>No scheduled programme. Continuous random AutoDJ continues while enabled and eligible music is available.</p>}
    </section>)}</div>
  </section>;
}

export default function TestRadioWeeklyPlanner({ stationId }) {
  const [state, setState] = useState(null), [form, setForm] = useState(() => testRadioWeeklyForm(null));
  const [baseline, setBaseline] = useState(() => testRadioWeeklyFormSnapshot(testRadioWeeklyForm(null)));
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [reviewHash, setReviewHash] = useState(null), [reviewOpen, setReviewOpen] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const sequence = useRef(0), abortRead = useRef(null), actionPending = useRef(false);
  const endpoint = `/api/admin/stations/${encodeURIComponent(stationId)}/continuous-schedule`;
  const unsaved = testRadioWeeklyFormSnapshot(form) !== baseline;
  const clearReview = () => { setReviewHash(null); setReviewOpen(false); setAcknowledged(false); };
  const adopt = useCallback((body, channelId = "") => {
    if (body.stationId !== TEST_RADIO_PLANNER_STATION_ID) throw new Error("Only Test Radio can use these controls.");
    const next = testRadioWeeklyForm(body, channelId);
    setState(body); setForm(next); setBaseline(testRadioWeeklyFormSnapshot(next)); setReviewHash(null); setReviewOpen(false); setAcknowledged(false); setSelectedIndex(0);
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
  useEffect(() => {
    if (!unsaved) return;
    const warn = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

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
  const updateRecipeSources = useCallback(recipes => setState(previous => mergeDeskRecipeSources(previous, recipes)), []);
  function addRecipeToWeek(recipe) {
    const item = deskRecipeProgramme(recipe);
    if (!item || state?.canEdit !== true || busy || form.items.length >= 200) return;
    clearReview(); setError(""); setMessage(`Added “${recipe.name}” to the unsaved week. Choose its day and time, then save and review.`);
    setState(previous => mergeDeskRecipeSources(previous, [recipe]));
    const replaceEmpty = form.items.length === 1 && !form.items[0].sourceId;
    setSelectedIndex(replaceEmpty ? 0 : form.items.length);
    setForm(previous => ({ ...previous, items: replaceEmpty ? [item] : [...previous.items, item] }));
  }
  function addEmptyProgramme() {
    if (form.items.length >= 200) return;
    clearReview(); setSelectedIndex(form.items.length); setForm({ ...form, items: [...form.items, testRadioWeeklyEmptyItem()] });
  }
  const editIndex = Math.min(selectedIndex, Math.max(0, form.items.length - 1)), item = form.items[editIndex];
  const playlistName = sourceId => state?.sources?.find(source => source.id === sourceId)?.name || "Choose saved playlist";
  if (stationId !== TEST_RADIO_PLANNER_STATION_ID) return null;
  return <section aria-labelledby="test-radio-weekly-title" className={styles.workspace}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>OWNER CONTROL · TEST RADIO ONLY</p>
      <div className={styles.headline}><h2 id="test-radio-weekly-title">Music. Programmes. Your week.</h2><span className={styles.pill}>Preparation workspace · no automatic publishing</span></div>
      <p>Build a playlist, place it in your week, then approve the saved plan. Random AutoDJ fills the gaps and returns automatically after each programme.</p>
    </header>
    <div className={styles.guide}><span><b>1</b> Choose or build a playlist</span><span><b>2</b> Place it in your week</span><span><b>3</b> Save → review → approve</span></div>
    <div className={styles.body}>
      <TestRadioPlaylistDesk stationId={stationId} onSourcesChanged={updateRecipeSources} onAddToWeek={addRecipeToWeek} canAddToWeek={state?.canEdit === true && !busy && form.items.length < 200} />
      <section className={styles.weekSection} aria-labelledby="weekly-editor-title">
        <div className={styles.toolbar}><h3 id="weekly-editor-title">Your weekly programmes</h3><span className={styles.tag}>{form.timezone}</span><button type="button" disabled={Boolean(busy)} onClick={() => refresh()}>Refresh saved plan</button></div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {message && <p role="status" className={styles.success}>{message}</p>}
        {!state && !error && <p role="status">Loading Test Radio’s saved plans and playlists…</p>}
        {state && <>
          <div className={styles.approvalStrip} role="status"><div><strong>{state.approved?.enabled ? `Approved for Test Radio: version ${state.approved.version}` : "No weekly version is approved for Test Radio."}</strong><small>{state.approved?.enabled ? `Time zone: ${state.approved.timezone}. New drafts do not replace it until separately approved.` : "Random AutoDJ continues whenever it is enabled."}</small></div><span className={styles.tag}>{unsaved ? "Unsaved draft" : `Saved draft ${state.draft?.version || "not created"}`}</span></div>
          {state.approved?.enabled && state.approved.effectiveAt && <p className={styles.hint}>Approved version effective from {new Date(state.approved.effectiveAt).toLocaleString("en-GB", { timeZone: state.approved.timezone })} · {state.approved.timezone}. Approval includes preparation time; it does not cut into a programme that is already in progress.</p>}
          {(state.warnings || []).map((warning, index) => <p key={index} role="note" className={styles.notice}>{warning}</p>)}
          <form onSubmit={event => command("save", event)}>
            <div className={styles.twoFields} style={{ marginBottom: 18 }}><label>Plan name<input required maxLength={120} disabled={Boolean(busy) || !state.canEdit} value={form.name} onChange={event => { clearReview(); setForm({ ...form, name: event.target.value }); }} /></label><label>Test Radio channel<select required disabled={Boolean(busy)} value={form.channelId} onChange={event => refresh(event.target.value)}><option value="">Choose channel</option>{(state.channels || []).map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label></div>
            <div className={styles.editLayout}>
              <section aria-label="Programme draft agenda">
                <p className={styles.sectionLabel}>Select a programme to edit</p>
                <ol className={styles.agenda}>{form.items.map((programme, index) => <li key={index}><button type="button" aria-pressed={editIndex === index} onClick={() => setSelectedIndex(index)} disabled={Boolean(busy)} aria-label={`Edit programme ${index + 1}: ${programme.label}`}>
                  <span className={styles.agendaTime}>{programme.recurrence === "WEEKLY" ? programme.startTime || "--:--" : programme.startsAt?.slice(11) || "--:--"}<small>{programme.recurrence === "WEEKLY" ? DAYS[programme.weekday]?.slice(0, 3) : programme.startsAt?.slice(0, 10) || "One time"}</small></span>
                  <span className={styles.agendaName}><strong>{programme.label}</strong><small>{playlistName(programme.sourceId)} · {programme.durationMinutes || "—"} min</small></span><span className={styles.meta}>{programme.recurrence === "WEEKLY" ? "Weekly" : "One-off"}</span>
                </button></li>)}</ol>
                <button type="button" className={styles.secondary} style={{ marginTop: 12 }} disabled={Boolean(busy) || !state.canEdit || form.items.length >= 200} onClick={addEmptyProgramme}>+ Add programme</button>
                <p className={styles.hint} style={{ marginTop: 12 }}>No programme scheduled? Random AutoDJ continues while it is enabled. These rows are your draft, not the live queue.</p>
              </section>
              <div className={styles.editor}>
                <h3>Edit programme {editIndex + 1}</h3>
                <fieldset disabled={Boolean(busy) || state.canEdit !== true}>
                  <div className={styles.formStack}>
                    <label>Programme name<input required maxLength={160} value={item.label} onChange={event => changeItem(editIndex, "label", event.target.value)} /></label>
                    <label>Saved music playlist<select required value={item.sourceId} onChange={event => changeItem(editIndex, "sourceId", event.target.value)}><option value="">Choose playlist</option>{(state.sources || []).map(source => <option key={source.id} value={source.id}>{source.name}</option>)}</select></label>
                    <div className={styles.twoFields}><label>Repeat<select value={item.recurrence} onChange={event => changeItem(editIndex, "recurrence", event.target.value)}><option value="WEEKLY">Every week</option><option value="ONE_OFF">One time only</option></select></label><label>Length in minutes<input required type="number" min="1" max="1440" value={item.durationMinutes} onChange={event => changeItem(editIndex, "durationMinutes", event.target.value)} /></label></div>
                    {item.recurrence === "WEEKLY" ? <div className={styles.twoFields}><label>Day<select value={item.weekday} onChange={event => changeItem(editIndex, "weekday", Number(event.target.value))}>{DAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label><label>Start time<input required type="time" value={item.startTime} onChange={event => changeItem(editIndex, "startTime", event.target.value)} /></label></div> : <label>Start date and time<input required type="datetime-local" value={item.startsAt} onChange={event => changeItem(editIndex, "startsAt", event.target.value)} /></label>}
                    <p className={styles.hint}>Times use {form.timezone}. At the exact start, this programme can cut the current song. At its end, random AutoDJ resumes.</p>
                  </div>
                  <details className={styles.disclosure}><summary>Advanced: overlap priority</summary><p>A higher number wins during overlaps. Equal-priority overlaps block approval.</p><label>Priority<input type="number" min="0" max="100" value={item.priority} onChange={event => changeItem(editIndex, "priority", event.target.value)} /></label></details>
                  <button type="button" className={styles.quiet} style={{ marginTop: 12 }} disabled={form.items.length === 1} onClick={() => { clearReview(); setForm({ ...form, items: form.items.filter((_, position) => position !== editIndex) }); setSelectedIndex(Math.max(0, editIndex - 1)); }}>Remove programme</button>
                </fieldset>
              </div>
            </div>
            {!state.canEdit && <p role="note" className={styles.notice}>Editing is unavailable. Check the channel, existing service permission and approved playlist sources.</p>}
            <div className={styles.weekActions}><p role="status">{unsaved ? "Unsaved changes — save a new draft before reviewing or approving." : `Saved version ${state.draft?.version || "not yet created"} is loaded. It does not affect the stream until approved.`}</p><button type="submit" className={styles.primary} disabled={Boolean(busy) || !state.canEdit || !form.channelId || !state.sources?.length}>{busy === "save" ? "Saving…" : "Save draft — no on-air change"}</button><button type="button" disabled={Boolean(busy) || unsaved || Boolean(error) || !state.draft?.preview} onClick={() => { setReviewHash(state.draft.reviewHash); setReviewOpen(true); setAcknowledged(false); }}>Review saved week</button></div>
          </form>
        </>}
        {reviewOpen && state?.draft && <><TestRadioWeeklyReview state={state} /><label className={styles.reviewAck}><input type="checkbox" checked={acknowledged} disabled={Boolean(busy)} onChange={event => setAcknowledged(event.target.checked)} /> I reviewed this saved week, its time zone and any overlap priorities. I approve exact starts that can cut the current song, followed by automatic return to random AutoDJ.</label><button type="button" className={styles.primary} disabled={Boolean(busy) || Boolean(error) || !approve || !testRadioWeeklyDays(state).length} onClick={() => command("approve")}>Approve version {state.draft.version} for Test Radio</button></>}
      </section>
      <details className={styles.disclosure}><summary>How scheduling works and advanced controls</summary><p><strong>Save draft → review saved week → approve for Test Radio.</strong> Saving or previewing never puts a new version on air. The source switches exactly at the approved time. Listeners may hear the change a few seconds later because of stream buffering.</p><p>These owner controls do not unlock tester publishing or change other channels. The subscriber <a href={`/dashboard/radio/schedule/${TEST_RADIO_PLANNER_STATION_ID}`}>weekly planner</a> retains its existing draft-only access. No new paid service is created; the existing US$15 monthly allowance still applies.</p><p>Disable scheduled takeovers to keep continuous random music instead. This does not stop AutoDJ or suspend the encoder.</p><button type="button" className={styles.danger} disabled={Boolean(busy)} onClick={() => command("disable")}>Disable scheduled takeovers — keep AutoDJ</button><div style={{ marginTop: 14 }}><label>Planner time zone<input value={form.timezone} readOnly={Boolean(state?.schedule)} disabled={Boolean(busy) || !state?.canEdit} onChange={event => { clearReview(); setForm({ ...form, timezone: event.target.value }); }} /></label><p>The time zone is fixed after creation. Clock-change ambiguities must be reviewed.</p></div></details>
    </div>
  </section>;
}
