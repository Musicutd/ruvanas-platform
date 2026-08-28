"use client";

import { useCallback, useEffect, useState } from "react";

const FINAL_STATUSES = new Set(["DELIVERED", "CANCELLED"]);

function Badge({ value }) {
  const palette = {
    DRAFT: ["#dbeafe", "#1e40af"], SUBMITTED: ["#fef3c7", "#92400e"], IN_PRODUCTION: ["#e0e7ff", "#3730a3"],
    AWAITING_CUSTOMER_APPROVAL: ["#f3e8ff", "#6b21a8"], CHANGES_REQUESTED: ["#ffedd5", "#9a3412"],
    APPROVED: ["#dcfce7", "#166534"], DELIVERED: ["#ccfbf1", "#115e59"], CANCELLED: ["#e2e8f0", "#475569"]
  };
  const [background, color] = palette[value] || ["#e2e8f0", "#334155"];
  return <span style={{ ...styles.badge, background, color }}>{String(value).replaceAll("_", " ")}</span>;
}

function formatDate(value, dateOnly = false) {
  if (!value) return "—";
  return dateOnly ? new Date(value).toLocaleDateString() : new Date(value).toLocaleString();
}

function campaignBuilderUrl(data, order, version) {
  const params = new URLSearchParams({
    organisationId: data.organisation.id,
    promoVersionId: version.id,
    name: order.title,
    ...(order.campaignStartsOn ? { effectiveFrom: String(order.campaignStartsOn).slice(0, 10) } : {}),
    ...(order.campaignEndsOn ? { effectiveTo: String(order.campaignEndsOn).slice(0, 10) } : {})
  });
  return `/admin/campaigns?${params.toString()}`;
}

function hasCurrentMasterHandoff(order) {
  const finalMaster = order.files.find((file) => file.kind === "FINAL_MASTER");
  if (!finalMaster) return false;
  return Boolean(order.promoAsset?.versions.some((version) => version.sourceReference === `production-order:${order.id}:file:${finalMaster.id}`));
}

export default function StudioClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/studio/orders", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Ruvanas Studio could not be loaded.");
    setData(payload);
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  async function createOrder(event) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = Object.fromEntries(values.entries());
    payload.languageCodes = String(payload.languageCodes || "").split(",").map((value) => value.trim()).filter(Boolean);
    payload.targetDurationSeconds = payload.targetDurationSeconds || null;
    payload.campaignStartsOn = payload.campaignStartsOn || null;
    payload.campaignEndsOn = payload.campaignEndsOn || null;
    payload.deadlineAt = payload.deadlineAt || null;
    payload.submitNow = values.get("submitNow") === "true";
    try {
      const response = await fetch("/api/studio/orders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The production order could not be created.");
      form.reset(); setNotice(payload.submitNow ? "Production brief submitted to Ruvanas Studio." : "Production brief saved as a draft."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function changeStatus(order, action) {
    let note = null;
    if (new Set(["REQUEST_CHANGES", "CANCEL"]).has(action)) {
      note = window.prompt(action === "CANCEL" ? "Reason for cancellation:" : "Changes required:", "");
      if (!note?.trim()) return;
    }
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/studio/orders/${order.id}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The production order could not be updated.");
      setNotice("Production order updated."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function assignOrder(event, order) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    const userId = new FormData(event.currentTarget).get("userId") || null;
    try {
      const response = await fetch(`/api/studio/orders/${order.id}/assignment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The production assignment could not be updated.");
      setNotice("Production assignment updated."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function createScript(event, order) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    const form = event.currentTarget; const payload = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch(`/api/studio/orders/${order.id}/scripts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The script version could not be created.");
      form.reset(); setNotice(`Script version ${result.script.version} created.`); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function recordCredit(event) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
    const payload = { ...values, quantity: Number(values.quantity), expiresAt: values.expiresAt ? new Date(`${values.expiresAt}T23:59:59.000Z`).toISOString() : null };
    try {
      const response = await fetch("/api/studio/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": `studio-credit:${crypto.randomUUID()}` },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The credit entry could not be recorded.");
      form.reset(); setNotice("Production-credit ledger updated."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function authorisePaidAddon(order) {
    const externalReference = window.prompt("Enter the paid add-on authorisation, invoice, or manual billing reference:", "");
    if (!externalReference?.trim()) return;
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/studio/orders/${order.id}/funding`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "AUTHORISE_PAID_ADD_ON", externalReference })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The paid add-on could not be authorised.");
      setNotice("Paid add-on authorised and its production credit reserved."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function createPromoHandoff(event, order) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
    const payload = { ...values, durationSeconds: values.durationSeconds ? Number(values.durationSeconds) : null };
    try {
      const response = await fetch(`/api/studio/orders/${order.id}/promo-handoff`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The promo handoff could not be created.");
      setNotice(result.created ? `Promo version ${result.version} created for QC review.` : "This final master is already in promo review."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function uploadFile(event, order) {
    event.preventDefault(); setWorking(true); setError(""); setNotice("");
    const form = event.currentTarget; const body = new FormData(form);
    try {
      const response = await fetch(`/api/studio/orders/${order.id}/files`, { method: "POST", body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The Studio file could not be uploaded.");
      form.reset(); setNotice("Studio file uploaded securely."); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  function actions(order) {
    if (!data) return null;
    const items = [];
    if (data.permissions.canCreate && order.status === "DRAFT") items.push(["SUBMIT", "Submit brief", styles.primary]);
    if (data.permissions.canProduce && order.status === "SUBMITTED" && ["RESERVED", "LEGACY_UNMETERED"].includes(order.fundingStatus)) items.push(["START_PRODUCTION", "Start production", styles.primary]);
    if (data.permissions.canProduce && order.status === "CHANGES_REQUESTED" && ["RESERVED", "LEGACY_UNMETERED"].includes(order.fundingStatus)) items.push(["RESUME_PRODUCTION", "Resume production", styles.primary]);
    if (data.permissions.canProduce && order.status === "IN_PRODUCTION") items.push(["REQUEST_APPROVAL", "Send for approval", styles.primary]);
    if (data.permissions.canManage && order.status === "AWAITING_CUSTOMER_APPROVAL") {
      items.push(["APPROVE", "Approve production", styles.approve], ["REQUEST_CHANGES", "Request changes", styles.secondary]);
    }
    if (data.permissions.canProduce && order.status === "APPROVED") items.push(["DELIVER", "Mark delivered", styles.approve]);
    if (!FINAL_STATUSES.has(order.status) && (data.permissions.canManage || data.permissions.canProduce)) items.push(["CANCEL", "Cancel", styles.danger]);
    return items.length ? <div style={styles.actions}>{items.map(([action, label, style]) => <button key={action} type="button" disabled={working} style={style} onClick={() => changeStatus(order, action)}>{label}</button>)}</div> : null;
  }

  if (!data) return <main style={styles.page}><a href="/dashboard" style={styles.back}>← Dashboard</a><p>{error || "Loading Ruvanas Studio…"}</p></main>;

  return <main style={styles.page}>
    <a href="/dashboard" style={styles.back}>← Dashboard</a>
    <header style={styles.header}><div><p style={styles.eyebrow}>RUVANAS STUDIO · RETAIL PRODUCTION</p><h1 style={styles.title}>{data.organisation.name}</h1><p style={styles.subtitle}>Submit a clear audio-production brief and follow its controlled journey from request to delivery.</p></div><span style={styles.privateLabel}>ORGANISATION PRIVATE</span></header>
    {error ? <div style={styles.error}>{error}</div> : null}{notice ? <div style={styles.notice}>{notice}</div> : null}

    <section style={{ ...styles.card, marginBottom: 20 }}>
      <div style={styles.itemHeader}><div><p style={styles.eyebrow}>PRODUCTION CREDITS</p><h2 style={styles.cardTitle}>Append-only credit ledger</h2></div><div style={styles.creditTotals}><span><strong>{data.credits.available}</strong> available</span><span><strong>{data.credits.reserved}</strong> reserved</span></div></div>
      <p style={styles.hint}>Each grant, purchase, reservation, consumption, release, expiry, and adjustment is retained as a numbered audit entry. No prices or automatic customer charges are configured.</p>
      {data.canManageCredits ? <details style={styles.workspace}><summary>Record a credit grant, expiry, or manual adjustment</summary><form onSubmit={recordCredit} style={styles.creditForm}>
        <label style={styles.compactLabel}>Entry type<select name="entryType" defaultValue="GRANT" style={styles.input}><option value="GRANT">Grant</option><option value="EXPIRY">Expiry</option><option value="ADJUSTMENT">Manual adjustment</option></select></label>
        <label style={styles.compactLabel}>Quantity<input name="quantity" type="number" defaultValue="1" min="-100000" max="100000" required style={styles.input} /></label>
        <label style={styles.compactLabel}>Reference (optional)<input name="externalReference" maxLength={240} style={styles.input} /></label>
        <label style={styles.compactLabel}>Expiry date (optional)<input name="expiresAt" type="date" style={styles.input} /></label>
        <label style={{ ...styles.compactLabel, gridColumn: "1 / -1" }}>Audit note<textarea name="note" minLength={3} maxLength={1000} required style={styles.textareaSmall} /></label>
        <button type="submit" disabled={working} style={styles.secondary}>Record immutable entry</button>
      </form></details> : null}
      {data.credits.entries.length ? <details style={styles.history}><summary>Recent ledger entries ({data.credits.entries.length})</summary>{data.credits.entries.map((entry) => <p key={entry.id} style={styles.historyItem}><strong>#{entry.sequence} {entry.entryType}</strong> · {entry.quantity} · available {entry.availableAfter} · reserved {entry.reservedAfter} · {formatDate(entry.createdAt)} · {entry.actor?.name || entry.actor?.email || "System"}{entry.order ? ` · ${entry.order.title}` : ""}{entry.note ? ` — ${entry.note}` : ""}</p>)}</details> : <p style={styles.hint}>No credit entries yet. A Super Admin can record the organisation’s first approved grant.</p>}
    </section>

    {data.permissions.canCreate ? <form onSubmit={createOrder} style={styles.card}>
      <p style={styles.eyebrow}>NEW PRODUCTION BRIEF</p><h2 style={styles.cardTitle}>Request professional audio</h2>
      <div style={styles.twoColumns}>
        <label style={styles.label}>Order title<input name="title" style={styles.input} maxLength={160} required /></label>
        <label style={styles.label}>Languages (comma-separated)<input name="languageCodes" style={styles.input} placeholder="en, mt" required /></label>
      </div>
      <label style={styles.label}>Promotion or offer details<textarea name="promotionDetails" style={styles.textarea} minLength={10} maxLength={5000} required /></label>
      <label style={styles.label}>Mandatory legal wording<textarea name="mandatoryLegalWording" style={styles.textareaSmall} maxLength={3000} /></label>
      <div style={styles.threeColumns}>
        <label style={styles.label}>Voice preference<input name="voicePreference" style={styles.input} maxLength={160} /></label>
        <label style={styles.label}>Tone and style<input name="toneStyle" style={styles.input} placeholder="Warm, energetic, premium…" maxLength={160} /></label>
        <label style={styles.label}>Target duration (seconds)<input name="targetDurationSeconds" style={styles.input} type="number" min="5" max="600" /></label>
      </div>
      <label style={styles.label}>Music-bed preference<input name="musicBedPreference" style={styles.input} maxLength={240} /></label>
      <div style={styles.threeColumns}>
        <label style={styles.label}>Campaign starts<input name="campaignStartsOn" style={styles.input} type="date" /></label>
        <label style={styles.label}>Campaign ends<input name="campaignEndsOn" style={styles.input} type="date" /></label>
        <label style={styles.label}>Requested delivery date<input name="deadlineAt" style={styles.input} type="date" /></label>
      </div>
      <label style={styles.label}>Brand pronunciation and supporting notes<textarea name="pronunciationNotes" style={styles.textareaSmall} maxLength={2000} /></label>
      <div style={styles.twoColumns}>
        <label style={styles.label}>Contact person<input name="contactName" style={styles.input} maxLength={160} required /></label>
        <label style={styles.label}>Contact email<input name="contactEmail" style={styles.input} type="email" maxLength={254} required /></label>
      </div>
      <div style={styles.threeColumns}>
        <label style={styles.label}>Funding<select name="fundingType" style={styles.input} defaultValue="PLAN_INCLUDED"><option value="PLAN_INCLUDED">Plan-included credit</option><option value="PAID_ADD_ON">Paid add-on</option></select></label>
        <label style={styles.label}>Priority<select name="priority" style={styles.input} defaultValue="STANDARD"><option value="STANDARD">Standard</option><option value="PRIORITY">Priority</option><option value="URGENT">Urgent</option></select></label>
        <label style={styles.label}>Submission<select name="submitNow" style={styles.input} defaultValue="true"><option value="true">Submit now</option><option value="false">Save draft</option></select></label>
      </div>
      <button style={styles.primary} disabled={working}>Create production order</button>
    </form> : null}

    <section style={{ ...styles.card, marginTop: 20 }}><p style={styles.eyebrow}>ORDER HISTORY</p><h2 style={styles.cardTitle}>Production orders</h2>
      {!data.orders.length ? <p style={styles.hint}>No production orders have been created for this organisation.</p> : <div style={styles.list}>{data.orders.map((order) => <article key={order.id} style={styles.item}>
        <div style={styles.itemHeader}><div><h3 style={styles.itemTitle}>{order.title}</h3><p style={styles.hint}>Created by {order.createdBy.name || order.createdBy.email} · {formatDate(order.createdAt)}</p></div><Badge value={order.status} /></div>
        <p style={styles.body}>{order.promotionDetails}</p>
        <div style={styles.meta}><span><strong>Languages:</strong> {order.languageCodes.join(", ")}</span><span><strong>Priority:</strong> {order.priority}</span><span><strong>Funding:</strong> {order.fundingType.replaceAll("_", " ")} · {order.fundingStatus.replaceAll("_", " ")}</span><span><strong>Deadline:</strong> {formatDate(order.deadlineAt, true)}</span></div>
        {data.canManageCredits && order.fundingType === "PAID_ADD_ON" && order.fundingStatus === "PENDING" && order.status === "SUBMITTED" ? <button type="button" disabled={working} style={styles.secondary} onClick={() => authorisePaidAddon(order)}>Authorise paid add-on</button> : null}
        {order.status === "SUBMITTED" && order.fundingStatus === "PENDING" ? <p style={styles.fundingWarning}>{order.fundingType === "PAID_ADD_ON" ? "Production is waiting for paid add-on authorisation." : "Production is waiting for an available plan credit."}</p> : null}
        <p style={styles.hint}><strong>Assigned:</strong> {order.assignedTo?.name || order.assignedTo?.email || "Not assigned"}</p>
        {order.mandatoryLegalWording ? <p style={styles.legal}><strong>Mandatory wording:</strong> {order.mandatoryLegalWording}</p> : null}
        {data.permissions.canProduce && !FINAL_STATUSES.has(order.status) ? <form onSubmit={(event) => assignOrder(event, order)} style={styles.inlineForm}>
          <label style={styles.compactLabel}>Production assignee<select name="userId" defaultValue={order.assignedTo?.id || ""} style={styles.input}><option value="">Not assigned</option>{data.staff.map((person) => <option key={person.id} value={person.id}>{person.name || person.email} · {person.role}</option>)}</select></label>
          <button type="submit" disabled={working} style={styles.secondary}>Update assignment</button>
        </form> : null}

        {!FINAL_STATUSES.has(order.status) && (data.permissions.canCreate || (data.permissions.canProduce && ["IN_PRODUCTION", "AWAITING_CUSTOMER_APPROVAL", "CHANGES_REQUESTED", "APPROVED"].includes(order.status))) ? <details style={styles.workspace}><summary>Add a private file</summary><form onSubmit={(event) => uploadFile(event, order)} style={styles.nestedForm}>
          <label style={styles.compactLabel}>File purpose<select name="kind" style={styles.input} required>
            {data.permissions.canCreate ? <option value="BRIEF_ATTACHMENT">Brief attachment</option> : null}
            {data.permissions.canProduce && ["IN_PRODUCTION", "AWAITING_CUSTOMER_APPROVAL", "CHANGES_REQUESTED"].includes(order.status) ? <option value="AUDIO_PREVIEW">Audio preview</option> : null}
            {data.permissions.canProduce && order.status === "APPROVED" ? <option value="FINAL_MASTER">Final master</option> : null}
          </select></label>
          <label style={styles.compactLabel}>Private file<input name="file" type="file" required style={styles.input} accept=".pdf,.txt,.png,.jpg,.jpeg,.mp3,.wav,.ogg,.m4a" /></label>
          <button type="submit" disabled={working} style={styles.secondary}>Upload securely</button>
          <span style={styles.hint}>Briefs: PDF, TXT, PNG or JPG up to 10 MB. Audio: MP3, WAV, OGG or M4A up to 50 MB.</span>
        </form></details> : null}

        {data.permissions.canProduce && ["IN_PRODUCTION", "CHANGES_REQUESTED"].includes(order.status) ? <details style={styles.workspace} open><summary>Create immutable script version</summary><form onSubmit={(event) => createScript(event, order)} style={styles.nestedForm}>
          <label style={styles.compactLabel}>Language code<input name="languageCode" style={styles.input} defaultValue={order.languageCodes[0] || "en"} required maxLength={35} /></label>
          <label style={styles.compactLabel}>Script<textarea name="content" style={styles.textarea} minLength={10} maxLength={12000} required /></label>
          <label style={styles.compactLabel}>Production notes<textarea name="productionNotes" style={styles.textareaSmall} maxLength={2000} /></label>
          <button type="submit" disabled={working} style={styles.secondary}>Save new script version</button>
        </form></details> : null}

        {order.scripts.length ? <details style={styles.workspace}><summary>Script versions ({order.scripts.length})</summary>{order.scripts.map((script) => <article key={script.id} style={styles.subItem}><strong>Version {script.version} · {script.languageCode}</strong><p style={styles.preWrap}>{script.content}</p>{script.productionNotes ? <p style={styles.hint}>Notes: {script.productionNotes}</p> : null}<p style={styles.hint}>{script.createdBy.name || script.createdBy.email} · {formatDate(script.createdAt)}</p></article>)}</details> : null}
        {order.files.length ? <details style={styles.workspace} open><summary>Private files ({order.files.length})</summary>{order.files.map((file) => <article key={file.id} style={styles.fileRow}><div><strong>{file.kind.replaceAll("_", " ")}</strong><p style={styles.hint}>{file.originalName} · {(Number(file.sizeBytes) / 1024 / 1024).toFixed(2)} MB · {formatDate(file.createdAt)}</p></div><a href={`/api/studio/files/${file.id}`} target="_blank" rel="noreferrer" style={styles.fileLink}>{file.kind === "BRIEF_ATTACHMENT" ? "Download" : "Open audio"}</a></article>)}</details> : null}
        {order.revisions.length ? <details style={styles.workspace} open><summary>Revision requests ({order.revisions.length})</summary>{order.revisions.map((revision) => <article key={revision.id} style={styles.subItem}><div style={styles.itemHeader}><strong>{revision.message}</strong><Badge value={revision.status} /></div><p style={styles.hint}>Requested by {revision.requestedBy.name || revision.requestedBy.email} · {formatDate(revision.createdAt)}{revision.resolvedAt ? ` · Resolved ${formatDate(revision.resolvedAt)}` : ""}</p></article>)}</details> : null}
        {data.permissions.canProduce && order.status === "DELIVERED" && !hasCurrentMasterHandoff(order) ? <details style={styles.workspace} open><summary>Send final master to promotional review</summary><form onSubmit={(event) => createPromoHandoff(event, order)} style={styles.nestedForm}>
          <div style={styles.threeColumns}><label style={styles.compactLabel}>Promo name<input name="name" defaultValue={order.title} maxLength={160} required style={styles.input} /></label><label style={styles.compactLabel}>Audio type<select name="mediaType" defaultValue="COMMERCIAL" style={styles.input}><option value="COMMERCIAL">Commercial</option><option value="JINGLE">Jingle</option><option value="ANNOUNCEMENT">Announcement</option><option value="VOICEOVER">Voiceover</option></select></label><label style={styles.compactLabel}>Language<input name="languageCode" defaultValue={order.languageCodes[0] || "und"} required style={styles.input} /></label></div>
          <label style={styles.compactLabel}>Verified duration in seconds (optional)<input name="durationSeconds" type="number" min="5" max="600" defaultValue={order.targetDurationSeconds || ""} style={styles.input} /></label>
          <button type="submit" disabled={working} style={styles.primary}>Create promo review handoff</button>
        </form></details> : null}
        {order.promoAsset ? <section style={styles.handoff}><strong>Promo handoff: {order.promoAsset.name}</strong>{order.promoAsset.versions.slice(0, 1).map((version) => <div key={version.id} style={styles.actions}><Badge value={version.status} /><span style={styles.hint}>Version {version.version} · QC {version.qcStatus.replaceAll("_", " ")}</span>{version.status === "APPROVED" ? <a href={campaignBuilderUrl(data, order, version)} style={styles.fileLink}>Open prefilled Campaign Builder</a> : <a href="/admin/media" style={styles.fileLink}>Open Promo Library for review</a>}</div>)}</section> : null}
        {actions(order)}
        <details style={styles.history}><summary>Workflow history ({order.events.length})</summary>{order.events.map((item) => <p key={item.id} style={styles.historyItem}><strong>{item.eventType.replaceAll("_", " ")}</strong> · {formatDate(item.createdAt)} · {item.actor?.name || item.actor?.email || "System"}{item.note ? ` — ${item.note}` : ""}</p>)}</details>
      </article>)}</div>}
    </section>
    <p style={styles.footerNote}>Studio files remain private and never expose storage addresses. Credit entries are immutable, and Studio masters must pass the existing promotional review before Campaign Builder can schedule them.</p>
  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#fff", padding: "36px max(20px, calc((100vw - 1160px)/2)) 72px", fontFamily: "Arial, sans-serif" },
  back: { color: "#f4b942", textDecoration: "none", fontWeight: 800 }, header: { display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start", margin: "34px 0 24px" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.2, margin: "0 0 8px" }, title: { fontSize: "clamp(34px,5vw,52px)", margin: 0 },
  subtitle: { color: "#b8c3d6", lineHeight: 1.6, maxWidth: 760 }, privateLabel: { border: "1px solid #64748b", borderRadius: 7, color: "#cbd5e1", padding: "7px 10px", fontSize: 11, fontWeight: 900 },
  card: { border: "1px solid #2b3a54", borderRadius: 14, background: "#182235", padding: 22 }, cardTitle: { margin: "0 0 18px" },
  twoColumns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }, threeColumns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 },
  label: { display: "grid", gap: 7, marginBottom: 14, color: "#dce5f3", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "11px 12px", font: "inherit" },
  textarea: { width: "100%", minHeight: 110, boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, padding: 12, font: "inherit" }, textareaSmall: { width: "100%", minHeight: 72, boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, padding: 12, font: "inherit" },
  primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "12px 16px", fontWeight: 900, cursor: "pointer" }, approve: { border: 0, borderRadius: 7, background: "#22c55e", color: "#052e16", padding: "8px 11px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, background: "transparent", color: "#e2e8f0", padding: "8px 11px", fontWeight: 800, cursor: "pointer" }, danger: { border: "1px solid #f87171", borderRadius: 7, background: "transparent", color: "#fecaca", padding: "8px 11px", fontWeight: 800, cursor: "pointer" },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }, list: { display: "grid", gap: 14 }, item: { border: "1px solid #34445f", borderRadius: 10, padding: 16, background: "#131e30" }, itemHeader: { display: "flex", justifyContent: "space-between", gap: 14 }, itemTitle: { margin: "0 0 5px" },
  badge: { display: "inline-block", borderRadius: 5, padding: "4px 8px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }, hint: { color: "#9facbf", lineHeight: 1.5, fontSize: 13 }, body: { color: "#d4dceb", lineHeight: 1.55 }, meta: { display: "flex", flexWrap: "wrap", gap: "8px 18px", color: "#b8c3d6", fontSize: 13 }, legal: { borderLeft: "3px solid #f4b942", paddingLeft: 10, color: "#fde68a", lineHeight: 1.5 },
  inlineForm: { display: "grid", gridTemplateColumns: "minmax(240px,1fr) auto", gap: 10, alignItems: "end", marginTop: 14 }, compactLabel: { display: "grid", gap: 6, color: "#dce5f3", fontWeight: 800, fontSize: 12 }, workspace: { marginTop: 14, border: "1px solid #34445f", borderRadius: 8, padding: 12, color: "#d4dceb" }, nestedForm: { display: "grid", gap: 10, marginTop: 12 }, subItem: { borderTop: "1px solid #34445f", padding: "12px 0" }, fileRow: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", borderTop: "1px solid #34445f", padding: "10px 0" }, fileLink: { color: "#f4b942", fontWeight: 900 }, preWrap: { whiteSpace: "pre-wrap", lineHeight: 1.55, color: "#d4dceb" },
  history: { marginTop: 14, color: "#b8c3d6", cursor: "pointer" }, historyItem: { borderTop: "1px solid #34445f", paddingTop: 8, fontSize: 12, lineHeight: 1.5 }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 16 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 16 }, footerNote: { color: "#8ea0b8", fontSize: 12, lineHeight: 1.5, marginTop: 20 },
  creditTotals: { display: "flex", gap: 12, flexWrap: "wrap" }, creditForm: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 12 }, fundingWarning: { borderLeft: "3px solid #f59e0b", paddingLeft: 10, color: "#fde68a", fontWeight: 800 }, handoff: { marginTop: 14, border: "1px solid #0f766e", borderRadius: 8, background: "#0f2f35", padding: 12 }
};

