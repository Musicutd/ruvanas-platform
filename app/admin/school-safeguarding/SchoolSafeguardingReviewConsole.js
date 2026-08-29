"use client";

import { useMemo, useState } from "react";

const statusLabels = {
  DRAFT: "Draft",
  READY_FOR_REVIEW: "Awaiting review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved"
};

async function recordDecision(readinessId, decision, notes) {
  const response = await fetch("/api/admin/school-safeguarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readinessId, decision, notes })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The review decision could not be saved.");
  return body;
}

export default function SchoolSafeguardingReviewConsole({ readinessPacks }) {
  const [filter, setFilter] = useState("READY_FOR_REVIEW");
  const [message, setMessage] = useState("");
  const visible = useMemo(() => filter === "ALL" ? readinessPacks : readinessPacks.filter((item) => item.status === filter), [filter, readinessPacks]);

  return <div style={styles.stack}>
    {message ? <div style={styles.message}>{message}</div> : null}
    <div style={styles.toolbar}>
      <label style={styles.label}>Show<select value={filter} onChange={(event) => setFilter(event.target.value)} style={styles.select}><option value="READY_FOR_REVIEW">Awaiting review</option><option value="CHANGES_REQUESTED">Changes requested</option><option value="APPROVED">Approved</option><option value="DRAFT">Drafts</option><option value="ALL">All packs</option></select></label>
      <span style={styles.count}>{visible.length} school{visible.length === 1 ? "" : "s"}</span>
    </div>
    {!visible.length ? <div style={styles.empty}>No safeguarding packs match this view.</div> : visible.map((pack) => <ReadinessCard key={pack.id} pack={pack} onMessage={setMessage} />)}
  </div>;
}

function ReadinessCard({ pack, onMessage }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision) {
    setBusy(true); onMessage("");
    try {
      await recordDecision(pack.id, decision, notes);
      onMessage(decision === "APPROVED" ? `${pack.organisation.name} safeguarding readiness approved. Student access remains locked.` : `Changes requested from ${pack.organisation.name}.`);
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) { onMessage(error.message); } finally { setBusy(false); }
  }

  return <section style={styles.card}>
    <div style={styles.headingRow}><div><h2 style={styles.heading}>{pack.organisation.name}</h2><p style={styles.help}>{pack.organisation.slug} · Submitted {pack.submittedAt ? new Date(pack.submittedAt).toLocaleString() : "not yet"}</p></div><span style={styles.badge}>{statusLabels[pack.status] || pack.status}</span></div>
    <div style={styles.metrics}>
      <Fact label="Countries" value={(pack.targetCountries || []).join(", ") || "Not set"} />
      <Fact label="Student ages" value={pack.minimumStudentAge == null ? "Not set" : `${pack.minimumStudentAge}–${pack.maximumStudentAge}`} />
      <Fact label="Consent" value={(pack.consentModel || "Not set").replaceAll("_", " ")} />
      <Fact label="Identity request" value={(pack.studentIdentityMode || "DISABLED").replaceAll("_", " ")} />
      <Fact label="Privacy contact" value={pack.privacyContactEmail || "Not set"} />
      <Fact label="Retention" value={`${pack.rawRecordingRetentionDays || "–"} / ${pack.consentEvidenceRetentionDays || "–"} days`} />
    </div>
    <div style={styles.policy}><strong>Local policy reference</strong><p>{pack.localPolicyReference || "Not supplied"}</p>{pack.notes ? <><strong>School notes</strong><p>{pack.notes}</p></> : null}</div>
    <div style={styles.declarations}><span>✓ Staff moderation</span><span>✓ No direct messaging</span><span>✓ Private by default</span></div>
    {pack.status === "READY_FOR_REVIEW" ? <div style={styles.reviewBox}>
      <label style={styles.label}>Decision notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength="4000" rows="4" placeholder="Required when requesting changes; optional approval record" style={styles.textarea} /></label>
      <div style={styles.actions}><button disabled={busy || !notes.trim()} onClick={() => decide("CHANGES_REQUESTED")} style={styles.secondary}>Request changes</button><button disabled={busy} onClick={() => decide("APPROVED")} style={styles.primary}>Approve readiness</button></div>
    </div> : null}
    {pack.reviews?.length ? <div style={styles.history}><h3 style={styles.historyTitle}>Decision history</h3>{pack.reviews.map((review) => <p key={review.id}><strong>{statusLabels[review.decision]}</strong> · {new Date(review.createdAt).toLocaleString()} · {review.reviewer.name || review.reviewer.email}{review.notes ? ` — ${review.notes}` : ""}</p>)}</div> : null}
  </section>;
}

function Fact({ label, value }) { return <div style={styles.fact}><span>{label}</span><strong>{value}</strong></div>; }

const styles = {
  stack: { display: "grid", gap: 16 }, toolbar: { display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }, label: { display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 }, select: { minWidth: 220, padding: 10, border: "1px solid #64748b", borderRadius: 7, background: "#fff" }, count: { color: "#64748b", fontWeight: 800 },
  card: { padding: 20, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" }, headingRow: { display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }, heading: { margin: 0, fontSize: 22, color: "#111827" }, help: { margin: "5px 0", color: "#64748b", fontSize: 12, lineHeight: 1.45 }, badge: { padding: "6px 9px", borderRadius: 6, background: "#e0f2fe", color: "#075985", fontSize: 12, fontWeight: 900 },
  metrics: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 9, marginTop: 16 }, fact: { display: "grid", gap: 4, padding: 11, border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff", color: "#64748b", fontSize: 12 }, policy: { marginTop: 12, padding: 13, borderLeft: "3px solid #94a3b8", background: "#fff", color: "#334155", fontSize: 13, lineHeight: 1.5 }, declarations: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, color: "#166534", fontSize: 12, fontWeight: 800 },
  reviewBox: { marginTop: 15, padding: 14, border: "1px solid #93c5fd", borderRadius: 9, background: "#eff6ff" }, textarea: { width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #64748b", borderRadius: 7, background: "#fff", color: "#111827", font: "inherit" }, actions: { display: "flex", gap: 9, marginTop: 10, flexWrap: "wrap" }, primary: { padding: "10px 14px", border: 0, borderRadius: 7, background: "#166534", color: "#fff", fontWeight: 850 }, secondary: { padding: "9px 12px", border: "1px solid #b45309", borderRadius: 7, background: "#fff", color: "#92400e", fontWeight: 800 },
  history: { marginTop: 15, paddingTop: 12, borderTop: "1px solid #cbd5e1", color: "#475569", fontSize: 12 }, historyTitle: { margin: "0 0 8px", color: "#334155", fontSize: 14 }, message: { padding: 12, border: "1px solid #0ea5e9", borderRadius: 8, background: "#e8f4ff", color: "#164e75", fontWeight: 750 }, empty: { padding: 24, border: "1px dashed #94a3b8", borderRadius: 10, color: "#64748b", textAlign: "center" }
};
