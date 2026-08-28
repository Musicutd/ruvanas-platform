"use client";

import { useEffect, useMemo, useState } from "react";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const initialWindow = () => ({ weekday: 1, startsAt: "09:00", endsAt: "17:00", at: "10:00", frequencyMode: "PLAYS_PER_HOUR", playsPerHour: 2, intervalMinutes: 30 });
const initialTarget = () => ({ targetType: "ALL_LOCATIONS", targetId: "" });

function Badge({ value }) {
  const colours = value === "PUBLISHED" ? ["#dcfce7", "#166534"] : value === "DRAFT" ? ["#fef3c7", "#92400e"] : ["#e2e8f0", "#334155"];
  return <span style={{ ...styles.badge, background: colours[0], color: colours[1] }}>{String(value).replaceAll("_", " ")}</span>;
}

export default function CampaignBuilder({ organisations, initialSelection = {} }) {
  const selectedOrganisation = organisations.find((item) => item.id === initialSelection.organisationId) || organisations[0];
  const selectedPromoVersion = selectedOrganisation?.promoAssets.flatMap((asset) => asset.versions).find((version) => version.id === initialSelection.promoVersionId);
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    organisationId: selectedOrganisation?.id || "",
    promoVersionId: selectedPromoVersion?.id || "",
    name: initialSelection.name || "",
    priority: "NORMAL",
    schedulingMode: "PLAYS_PER_HOUR",
    playsPerHour: 2,
    intervalMinutes: 30,
    effectiveFrom: /^\d{4}-\d{2}-\d{2}$/.test(initialSelection.effectiveFrom) ? initialSelection.effectiveFrom : today,
    effectiveTo: /^\d{4}-\d{2}-\d{2}$/.test(initialSelection.effectiveTo) ? initialSelection.effectiveTo : nextWeek,
    maxPromoMinutesPerHour: 12,
    minSamePromoGapMinutes: 15,
    minAnyPromoGapMinutes: 2,
    mandatory: false,
    respectOpeningHours: true,
    exactTimeHardStart: false
  });
  const [targets, setTargets] = useState([initialTarget()]);
  const [schedules, setSchedules] = useState([initialWindow()]);
  const [campaigns, setCampaigns] = useState([]);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const organisation = useMemo(() => organisations.find((item) => item.id === form.organisationId), [organisations, form.organisationId]);
  const promoVersions = useMemo(() => (organisation?.promoAssets || []).flatMap((asset) => asset.versions.map((version) => ({ ...version, label: `${asset.name} · v${version.version} · ${version.languageCode}` }))), [organisation]);

  async function loadCampaigns() {
    const response = await fetch("/api/admin/campaigns", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to load campaigns.");
    setCampaigns(data.campaigns || []);
  }

  useEffect(() => { loadCampaigns().catch((error) => setMessage(error.message)); }, []);

  function field(event) {
    const { name, value, type, checked } = event.target;
    setPreview(null);
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : type === "number" ? Number(value) : value,
      ...(name === "organisationId" ? { promoVersionId: "" } : {})
    }));
    if (name === "organisationId") setTargets([initialTarget()]);
  }

  function targetOptions(targetType) {
    if (targetType === "BRAND") return organisation?.brands || [];
    if (targetType === "LOCATION_GROUP") return organisation?.locationGroups || [];
    if (targetType === "LOCATION") return organisation?.locations || [];
    if (targetType === "ZONE") return (organisation?.locations || []).flatMap((location) => location.zones.map((zone) => ({ id: zone.id, name: `${location.name} / ${zone.name}` })));
    return [];
  }

  function targetField(index, event) {
    setPreview(null);
    setTargets((current) => current.map((target, currentIndex) => currentIndex === index
      ? { ...target, [event.target.name]: event.target.value, ...(event.target.name === "targetType" ? { targetId: "" } : {}) }
      : target));
  }

  function scheduleField(index, event) {
    setPreview(null);
    const numeric = new Set(["weekday", "playsPerHour", "intervalMinutes"]);
    setSchedules((current) => current.map((schedule, currentIndex) => currentIndex === index
      ? { ...schedule, [event.target.name]: numeric.has(event.target.name) ? Number(event.target.value) : event.target.value }
      : schedule));
  }

  function payload() {
    return { ...form, targets, schedules };
  }

  async function requestPreview() {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/admin/campaigns/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to preview the campaign.");
      setPreview(data.preview);
    } catch (error) { setPreview(null); setMessage(error.message); } finally { setWorking(false); }
  }

  async function saveDraft() {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save the campaign draft.");
      setPreview(data.preview); setMessage("Campaign draft saved. Review its preview, then publish it from the list below.");
      setForm((current) => ({ ...current, name: "" }));
      await loadCampaigns();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }

  async function changeCampaign(campaignId, action, status) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/campaigns/${campaignId}/${action}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(status ? { body: JSON.stringify({ status }) } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to update the campaign.");
      setMessage(action === "publish" ? "Campaign published after server-side guardrail checks." : `Campaign ${status.toLowerCase()}.`);
      await loadCampaigns();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }

  const exact = form.schedulingMode === "EXACT_TIMES";
  const advanced = form.schedulingMode === "ADVANCED_DAYPART";

  return <main style={styles.page}>
    <div style={styles.header}><div><p style={styles.eyebrow}>Milestone 3B</p><h1 style={styles.title}>Campaign builder</h1><p style={styles.copy}>Target approved promo versions to brands, groups, locations, or zones. Preview estimated plays and conflicts before an audited publication.</p></div></div>
    {message ? <div role="status" style={styles.message}>{message}</div> : null}
    <section style={styles.panel}><h2 style={styles.sectionTitle}>1. Campaign details</h2>
      <div style={styles.grid}>
        <label style={styles.label}>Organisation<select name="organisationId" value={form.organisationId} onChange={field} style={styles.input}>{organisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label style={styles.label}>Approved promo version<select required name="promoVersionId" value={form.promoVersionId} onChange={field} style={styles.input}><option value="">Choose approved audio</option>{promoVersions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label style={styles.label}>Campaign name<input required maxLength={120} name="name" value={form.name} onChange={field} style={styles.input} placeholder="September lunch offer" /></label>
        <label style={styles.label}>Priority<select name="priority" value={form.priority} onChange={field} style={styles.input}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="VERY_HIGH">Very high</option></select></label>
        <label style={styles.label}>Start date<input type="date" name="effectiveFrom" value={form.effectiveFrom} onChange={field} style={styles.input} /></label>
        <label style={styles.label}>End date<input type="date" name="effectiveTo" value={form.effectiveTo} onChange={field} style={styles.input} /></label>
      </div>
      <div style={styles.checks}><label><input type="checkbox" name="respectOpeningHours" checked={form.respectOpeningHours} onChange={field} /> Respect location opening hours</label><label><input type="checkbox" name="mandatory" checked={form.mandatory} onChange={field} /> Mandatory corporate campaign</label></div>
    </section>

    <section style={styles.panel}><h2 style={styles.sectionTitle}>2. Targets</h2>{targets.map((target, index) => <div key={index} style={styles.row}>
      <select aria-label={`Target type ${index + 1}`} name="targetType" value={target.targetType} onChange={(event) => targetField(index, event)} style={styles.input}><option value="ALL_LOCATIONS">All locations</option><option value="BRAND">Brand</option><option value="LOCATION_GROUP">Location group</option><option value="LOCATION">Location</option><option value="ZONE">Zone</option></select>
      {target.targetType !== "ALL_LOCATIONS" ? <select aria-label={`Target ${index + 1}`} required name="targetId" value={target.targetId} onChange={(event) => targetField(index, event)} style={styles.input}><option value="">Choose target</option>{targetOptions(target.targetType).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : <div style={styles.coverage}>Every active zone in the organisation</div>}
      <button type="button" disabled={targets.length === 1} onClick={() => setTargets((current) => current.filter((_, currentIndex) => currentIndex !== index))}>Remove</button>
    </div>)}<button type="button" style={styles.secondary} onClick={() => setTargets((current) => [...current, { targetType: "LOCATION", targetId: "" }])}>Add target</button></section>

    <section style={styles.panel}><h2 style={styles.sectionTitle}>3. Frequency and weekly windows</h2>
      <div style={styles.grid}>
        <label style={styles.label}>Scheduling mode<select name="schedulingMode" value={form.schedulingMode} onChange={field} style={styles.input}><option value="PLAYS_PER_HOUR">Plays per hour</option><option value="INTERVAL">Interval</option><option value="EXACT_TIMES">Exact times</option><option value="ADVANCED_DAYPART">Advanced dayparts</option><option value="SMART_PRIORITY">Smart priority</option></select></label>
        {form.schedulingMode === "PLAYS_PER_HOUR" ? <label style={styles.label}>Plays per hour<input type="number" min="1" max="12" name="playsPerHour" value={form.playsPerHour} onChange={field} style={styles.input} /></label> : null}
        {form.schedulingMode === "INTERVAL" ? <label style={styles.label}>Every N minutes<input type="number" min="5" max="180" name="intervalMinutes" value={form.intervalMinutes} onChange={field} style={styles.input} /></label> : null}
        {exact ? <label style={styles.check}><input type="checkbox" name="exactTimeHardStart" checked={form.exactTimeHardStart} onChange={field} /> Treat exact times as hard starts</label> : null}
      </div>
      {schedules.map((schedule, index) => <div key={index} style={styles.scheduleRow}>
        <select aria-label={`Weekday ${index + 1}`} name="weekday" value={schedule.weekday} onChange={(event) => scheduleField(index, event)} style={styles.input}>{WEEKDAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select>
        {exact ? <input aria-label={`Exact time ${index + 1}`} type="time" name="at" value={schedule.at} onChange={(event) => scheduleField(index, event)} style={styles.input} /> : <><input aria-label={`Start ${index + 1}`} type="time" name="startsAt" value={schedule.startsAt} onChange={(event) => scheduleField(index, event)} style={styles.input} /><input aria-label={`End ${index + 1}`} type="time" name="endsAt" value={schedule.endsAt} onChange={(event) => scheduleField(index, event)} style={styles.input} /></>}
        {advanced ? <><select aria-label={`Frequency mode ${index + 1}`} name="frequencyMode" value={schedule.frequencyMode} onChange={(event) => scheduleField(index, event)} style={styles.input}><option value="PLAYS_PER_HOUR">Plays/hour</option><option value="INTERVAL">Interval</option></select><input aria-label={`Frequency value ${index + 1}`} type="number" min="1" max="180" name={schedule.frequencyMode === "INTERVAL" ? "intervalMinutes" : "playsPerHour"} value={schedule.frequencyMode === "INTERVAL" ? schedule.intervalMinutes : schedule.playsPerHour} onChange={(event) => scheduleField(index, event)} style={styles.small} /></> : null}
        <button type="button" disabled={schedules.length === 1} onClick={() => setSchedules((current) => current.filter((_, currentIndex) => currentIndex !== index))}>Remove</button>
      </div>)}
      <button type="button" style={styles.secondary} onClick={() => setSchedules((current) => [...current, initialWindow()])}>Add time window</button>
    </section>

    <section style={styles.panel}><h2 style={styles.sectionTitle}>4. Safety guardrails</h2><div style={styles.grid}>
      <label style={styles.label}>Maximum promo minutes/hour<input type="number" min="1" max="60" name="maxPromoMinutesPerHour" value={form.maxPromoMinutesPerHour} onChange={field} style={styles.input} /></label>
      <label style={styles.label}>Minimum same-promo gap (minutes)<input type="number" min="1" max="720" name="minSamePromoGapMinutes" value={form.minSamePromoGapMinutes} onChange={field} style={styles.input} /></label>
      <label style={styles.label}>Minimum gap between any promos<input type="number" min="0" max="720" name="minAnyPromoGapMinutes" value={form.minAnyPromoGapMinutes} onChange={field} style={styles.input} /></label>
    </div></section>

    <div style={styles.actions}><button type="button" onClick={requestPreview} disabled={working} style={styles.secondary}>Preview and check conflicts</button><button type="button" onClick={saveDraft} disabled={working || !preview?.canPublish} style={styles.primary}>Save checked draft</button></div>
    {preview ? <section style={preview.canPublish ? styles.previewGood : styles.previewBad}><h2 style={styles.sectionTitle}>{preview.canPublish ? "Ready to save" : "Publication blocked"}</h2><div style={styles.summary}><strong>{preview.targetZoneCount}</strong> zones · <strong>{preview.estimatedPlaysPerZone}</strong> estimated plays per zone · <strong>{preview.estimatedTotalPlays}</strong> total over {preview.activeDays} days</div>{preview.errors.map((item) => <p key={item} style={styles.error}>Blocked: {item}</p>)}{preview.warnings.map((item) => <p key={item} style={styles.warning}>Warning: {item}</p>)}</section> : null}

    <section style={{ marginTop: 40 }}><h2 style={styles.title}>Campaigns</h2>{campaigns.length === 0 ? <div style={styles.empty}>No campaign drafts yet.</div> : <div style={styles.cards}>{campaigns.map((campaign) => <article key={campaign.id} style={styles.card}><div><h3 style={{ margin: 0 }}>{campaign.name}</h3><p style={styles.muted}>{campaign.organisation.name} · {campaign.promoVersion.promoAsset.name} v{campaign.promoVersion.version}</p></div><Badge value={campaign.status} /><div style={styles.muted}>{campaign.schedulingMode.replaceAll("_", " ")} · {campaign.priority} · {campaign.targets.length} target rule(s)</div><div style={styles.cardActions}>{campaign.status === "DRAFT" ? <button disabled={working} onClick={() => changeCampaign(campaign.id, "publish")} style={styles.primary}>Publish</button> : null}{campaign.status === "PUBLISHED" ? <button disabled={working} onClick={() => changeCampaign(campaign.id, "status", "PAUSED")} style={styles.secondary}>Pause</button> : null}{["DRAFT", "PAUSED", "ENDED"].includes(campaign.status) ? <button disabled={working} onClick={() => changeCampaign(campaign.id, "status", "ARCHIVED")}>Archive</button> : null}</div></article>)}</div>}</section>
  </main>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  header: { marginBottom: 22 }, eyebrow: { margin: "0 0 8px", color: "#9a6400", fontWeight: 900, textTransform: "uppercase" }, title: { margin: 0, fontSize: 32 }, copy: { maxWidth: 800, color: "#475569", lineHeight: 1.55 },
  message: { marginBottom: 18, padding: 12, border: "1px solid #93c5fd", borderRadius: 8, background: "#eff6ff", color: "#1e3a8a", fontWeight: 700 }, panel: { display: "grid", gap: 16, marginBottom: 18, padding: 22, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" }, sectionTitle: { margin: 0, fontSize: 20 }, grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 14 }, label: { display: "grid", gap: 7, fontWeight: 800 }, input: { minWidth: 0, padding: 10, border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", font: "inherit" }, small: { width: 88, padding: 10, border: "1px solid #94a3b8", borderRadius: 7 }, checks: { display: "flex", gap: 20, flexWrap: "wrap", fontWeight: 800 }, check: { display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }, row: { display: "grid", gridTemplateColumns: "minmax(180px,.8fr) minmax(260px,1.5fr) auto", gap: 10, alignItems: "center" }, scheduleRow: { display: "grid", gridTemplateColumns: "minmax(130px,1fr) repeat(4,minmax(90px,.8fr)) auto", gap: 8, alignItems: "center" }, coverage: { padding: 10, color: "#475569" }, actions: { display: "flex", gap: 12, margin: "22px 0", flexWrap: "wrap" }, primary: { border: 0, borderRadius: 7, padding: "11px 15px", background: "#f4b942", color: "#172033", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 13px", background: "#fff", color: "#172033", fontWeight: 800, cursor: "pointer" }, previewGood: { padding: 20, border: "1px solid #86efac", borderRadius: 10, background: "#f0fdf4" }, previewBad: { padding: 20, border: "1px solid #fca5a5", borderRadius: 10, background: "#fef2f2" }, summary: { marginTop: 10, color: "#334155" }, error: { color: "#991b1b", fontWeight: 700 }, warning: { color: "#92400e", fontWeight: 700 }, empty: { marginTop: 16, padding: 24, border: "1px dashed #94a3b8", borderRadius: 10 }, cards: { display: "grid", gap: 12, marginTop: 16 }, card: { display: "grid", gridTemplateColumns: "minmax(240px,1.5fr) auto minmax(220px,1fr) auto", gap: 16, alignItems: "center", padding: 18, border: "1px solid #cbd5e1", borderRadius: 10 }, muted: { margin: "6px 0 0", color: "#64748b", fontWeight: 600 }, badge: { display: "inline-block", padding: "5px 8px", borderRadius: 999, fontSize: 12, fontWeight: 900 }, cardActions: { display: "flex", gap: 8, flexWrap: "wrap" }
};

