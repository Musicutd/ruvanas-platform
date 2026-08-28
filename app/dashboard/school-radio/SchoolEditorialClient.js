"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function Badge({ value }) {
  const palette = { APPROVED: ["#dcfce7", "#166534"], IN_REVIEW: ["#fef3c7", "#92400e"], CHANGES_REQUESTED: ["#ffedd5", "#9a3412"], REJECTED: ["#fee2e2", "#991b1b"], DRAFT: ["#dbeafe", "#1e40af"], GRANTED: ["#dcfce7", "#166534"], REVOKED: ["#fee2e2", "#991b1b"], PENDING: ["#fef3c7", "#92400e"] };
  const [background, color] = palette[value] || ["#e2e8f0", "#334155"];
  return <span style={{ ...s.badge, background, color }}>{String(value).replaceAll("_", " ")}</span>;
}

export default function SchoolEditorialClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [group, setGroup] = useState({ name: "", academicYear: "" });
  const [contributor, setContributor] = useState({ studentGroupId: "", displayName: "", referenceCode: "" });
  const [programme, setProgramme] = useState({ title: "", description: "", studentGroupId: "" });
  const [episode, setEpisode] = useState({ programmeId: "", title: "", summary: "", contributorIds: [] });
  const [submission, setSubmission] = useState({ episodeId: "", promoVersionId: "", notes: "" });

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/editorial", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The editorial workspace could not be loaded.");
    setData(payload);
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  const contributors = useMemo(() => (data?.groups || []).flatMap((item) => item.contributors.map((person) => ({ ...person, groupName: item.name }))), [data]);
  const reviewableEpisodes = useMemo(() => (data?.episodes || []).filter((item) => ["DRAFT", "CHANGES_REQUESTED"].includes(item.status)), [data]);

  async function act(payload, success) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/editorial", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The editorial action could not be completed.");
      setNotice(success); await load(); return true;
    } catch (actionError) { setError(actionError.message); return false; } finally { setWorking(false); }
  }

  async function review(item, action) {
    let notes = null;
    if (["REQUEST_CHANGES", "REJECT"].includes(action)) {
      notes = window.prompt(action === "REJECT" ? "Reason for rejection:" : "What should be changed?", "");
      if (!notes?.trim()) return;
    }
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/school-radio/episodes/${item.id}/review`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, notes }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The moderation decision could not be saved.");
      setNotice(`Episode ${action.toLowerCase().replaceAll("_", " ")}.`); await load();
    } catch (actionError) { setError(actionError.message); } finally { setWorking(false); }
  }

  async function recordConsent(person, status) {
    const notes = window.prompt(status === "GRANTED" ? "Consent evidence/reference (do not enter sensitive personal details):" : "Reason or note:", "");
    if (notes === null) return;
    await act({ action: "RECORD_CONSENT", contributorId: person.id, status, notes }, `Consent status recorded as ${status.toLowerCase()}.`);
  }

  if (!data) return <section style={s.card}><p style={s.eyebrow}>SCHOOL PRODUCTIONS</p><p style={s.hint}>{error || "Loading editorial workflow…"}</p></section>;

  return <section style={s.wrapper}>
    <div style={s.heading}><div><p style={s.eyebrow}>STAGE 4B · SUPERVISED EDITORIAL WORKFLOW</p><h2 style={s.title}>Programmes and student productions</h2><p style={s.hint}>Staff-controlled from group setup through audio submission and moderation. Everything remains private to your organisation.</p></div><Badge value={data.safety.publicationScope} /></div>
    {error ? <div style={s.error}>{error}</div> : null}{notice ? <div style={s.notice}>{notice}</div> : null}

    {data.permissions.canModerate ? <div style={s.grid}>
      <form style={s.card} onSubmit={async (event) => { event.preventDefault(); if (await act({ action: "CREATE_GROUP", ...group }, "Student group created.")) setGroup({ name: "", academicYear: "" }); }}>
        <p style={s.eyebrow}>1 · STAFF SETUP</p><h3 style={s.cardTitle}>Student group</h3>
        <label style={s.label}>Group name<input style={s.input} value={group.name} onChange={(event) => setGroup({ ...group, name: event.target.value })} placeholder="Year 8 Radio Club" required /></label>
        <label style={s.label}>Academic year<input style={s.input} value={group.academicYear} onChange={(event) => setGroup({ ...group, academicYear: event.target.value })} placeholder="2026/27" /></label>
        <button style={s.primary} disabled={working}>Create supervised group</button>
      </form>

      <form style={s.card} onSubmit={async (event) => { event.preventDefault(); if (await act({ action: "CREATE_CONTRIBUTOR", ...contributor }, "Contributor added without creating a student login.")) setContributor({ studentGroupId: "", displayName: "", referenceCode: "" }); }}>
        <p style={s.eyebrow}>2 · CONTRIBUTORS</p><h3 style={s.cardTitle}>Add student contributor</h3>
        <label style={s.label}>Group<select style={s.input} value={contributor.studentGroupId} onChange={(event) => setContributor({ ...contributor, studentGroupId: event.target.value })} required><option value="">Choose group…</option>{data.groups.map((item) => <option key={item.id} value={item.id}>{item.name}{item.academicYear ? ` · ${item.academicYear}` : ""}</option>)}</select></label>
        <label style={s.label}>Display name<input style={s.input} value={contributor.displayName} onChange={(event) => setContributor({ ...contributor, displayName: event.target.value })} placeholder="First name or school-approved credit" required /></label>
        <label style={s.label}>Internal reference (optional)<input style={s.input} value={contributor.referenceCode} onChange={(event) => setContributor({ ...contributor, referenceCode: event.target.value })} /></label>
        <button style={s.primary} disabled={working || !data.groups.length}>Add contributor</button>
      </form>

      <form style={s.card} onSubmit={async (event) => { event.preventDefault(); if (await act({ action: "CREATE_PROGRAMME", ...programme, studentGroupId: programme.studentGroupId || null }, "Programme created.")) setProgramme({ title: "", description: "", studentGroupId: "" }); }}>
        <p style={s.eyebrow}>3 · PROGRAMME</p><h3 style={s.cardTitle}>Create programme</h3>
        <label style={s.label}>Title<input style={s.input} value={programme.title} onChange={(event) => setProgramme({ ...programme, title: event.target.value })} placeholder="Student Voices" required /></label>
        <label style={s.label}>Group (optional)<select style={s.input} value={programme.studentGroupId} onChange={(event) => setProgramme({ ...programme, studentGroupId: event.target.value })}><option value="">No fixed group</option>{data.groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label style={s.label}>Description<textarea style={{ ...s.input, minHeight: 72 }} value={programme.description} onChange={(event) => setProgramme({ ...programme, description: event.target.value })} /></label>
        <button style={s.primary} disabled={working}>Create programme</button>
      </form>
    </div> : <div style={s.info}>Programme, group, contributor, consent, and moderation controls are available to organisation owners and managers.</div>}

    <div style={{ ...s.grid, marginTop: 16 }}>
      <form style={s.card} onSubmit={async (event) => { event.preventDefault(); if (await act({ action: "CREATE_EPISODE", ...episode }, "Episode draft created.")) setEpisode({ programmeId: "", title: "", summary: "", contributorIds: [] }); }}>
        <p style={s.eyebrow}>4 · EPISODE</p><h3 style={s.cardTitle}>Plan an episode</h3>
        <label style={s.label}>Programme<select style={s.input} value={episode.programmeId} onChange={(event) => setEpisode({ ...episode, programmeId: event.target.value })} required><option value="">Choose programme…</option>{data.programmes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label style={s.label}>Episode title<input style={s.input} value={episode.title} onChange={(event) => setEpisode({ ...episode, title: event.target.value })} required /></label>
        <label style={s.label}>Contributors<select multiple size={Math.min(5, Math.max(2, contributors.length))} style={s.input} value={episode.contributorIds} onChange={(event) => setEpisode({ ...episode, contributorIds: Array.from(event.target.selectedOptions, (option) => option.value) })}>{contributors.map((person) => <option key={person.id} value={person.id}>{person.displayName} · {person.groupName}</option>)}</select></label>
        <label style={s.label}>Editorial summary<textarea style={{ ...s.input, minHeight: 72 }} value={episode.summary} onChange={(event) => setEpisode({ ...episode, summary: event.target.value })} /></label>
        <button style={s.primary} disabled={working || !data.programmes.length}>Create episode draft</button>
      </form>

      <form style={s.card} onSubmit={async (event) => { event.preventDefault(); if (await act({ action: "SUBMIT_EPISODE", ...submission }, "Audio revision submitted for staff moderation.")) setSubmission({ episodeId: "", promoVersionId: "", notes: "" }); }}>
        <p style={s.eyebrow}>5 · SUBMISSION</p><h3 style={s.cardTitle}>Submit audio for moderation</h3>
        <label style={s.label}>Episode<select style={s.input} value={submission.episodeId} onChange={(event) => setSubmission({ ...submission, episodeId: event.target.value })} required><option value="">Choose draft or returned episode…</option>{reviewableEpisodes.map((item) => <option key={item.id} value={item.id}>{item.programme.title} · {item.title}</option>)}</select></label>
        <label style={s.label}>School audio<select style={s.input} value={submission.promoVersionId} onChange={(event) => setSubmission({ ...submission, promoVersionId: event.target.value })} required><option value="">Choose uploaded audio…</option>{data.audioVersions.map((item) => <option key={item.id} value={item.id}>{item.promoAsset.name} · v{item.version} · {item.status.replaceAll("_", " ")}</option>)}</select></label>
        <label style={s.label}>Production note<textarea style={{ ...s.input, minHeight: 72 }} value={submission.notes} onChange={(event) => setSubmission({ ...submission, notes: event.target.value })} /></label>
        <button style={s.primary} disabled={working || !reviewableEpisodes.length || !data.audioVersions.length}>Submit revision</button>
        <p style={s.hint}>Need audio? <a href="/dashboard/media" style={s.link}>Upload it in Ruvanas</a>. Audio still passes the existing approval check before an episode can be approved.</p>
      </form>
    </div>

    <section style={{ ...s.card, marginTop: 16 }}><p style={s.eyebrow}>6 · MODERATION & CONSENT</p><h3 style={s.cardTitle}>Episode board</h3>
      {!data.episodes.length ? <p style={s.hint}>No episodes yet. Create a programme and its first episode above.</p> : <div style={s.list}>{data.episodes.map((item) => {
        const current = item.submissions[0];
        return <article key={item.id} style={s.item}><div style={s.row}><div><strong>{item.programme.title} · {item.title}</strong><p style={s.hint}>{item.contributors.length ? item.contributors.map(({ contributor: person }) => person.displayName).join(", ") : "No student contributors credited"}</p></div><Badge value={item.status} /></div>
          {item.summary ? <p style={s.body}>{item.summary}</p> : null}
          {current ? <p style={s.hint}>Revision {current.revision}: {current.promoVersion.promoAsset.name} · audio {current.promoVersion.status.replaceAll("_", " ")}</p> : <p style={s.hint}>Waiting for its first audio submission.</p>}
          {current?.reviews?.length ? <p style={s.review}>Latest moderation: {current.reviews[0].decision.replaceAll("_", " ")}{current.reviews[0].notes ? ` — ${current.reviews[0].notes}` : ""}</p> : null}
          {data.permissions.canModerate && item.status === "IN_REVIEW" ? <div style={s.actions}><button style={s.approve} disabled={working || current?.promoVersion.status !== "APPROVED"} onClick={() => review(item, "APPROVE")}>Approve episode</button><button style={s.secondary} disabled={working} onClick={() => review(item, "REQUEST_CHANGES")}>Request changes</button><button style={s.danger} disabled={working} onClick={() => review(item, "REJECT")}>Reject</button></div> : null}
          {data.permissions.canModerate && item.contributors.length ? <details style={s.consent}><summary>Consent records</summary>{item.contributors.map(({ contributor: person }) => {
            const latest = data.consentRecords.find((record) => record.contributorId === person.id && (!record.episodeId || record.episodeId === item.id));
            return <div key={person.id} style={s.row}><span>{person.displayName} {latest ? <Badge value={latest.status} /> : <Badge value="PENDING" />}</span><span><button style={s.linkButton} disabled={working} onClick={() => recordConsent(person, "GRANTED")}>Record granted</button><button style={s.linkButton} disabled={working} onClick={() => recordConsent(person, "REVOKED")}>Revoke</button></span></div>;
          })}</details> : null}
        </article>;
      })}</div>}
    </section>
    <p style={s.safety}>Private by default · staff moderation required · consent is recorded as an auditable event · public publishing remains disabled until a later controlled release.</p>
  </section>;
}

const s = {
  wrapper: { border: "1px solid #3b4b66", borderRadius: 16, background: "#111d30", padding: 22, marginBottom: 22 },
  heading: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 16 },
  title: { margin: "0 0 8px", fontSize: 28 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 },
  card: { border: "1px solid #34445f", borderRadius: 12, background: "#182235", padding: 18 }, cardTitle: { margin: "0 0 15px" },
  label: { display: "grid", gap: 6, marginBottom: 12, color: "#dce5f3", fontWeight: 800, fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 7, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" },
  primary: { border: 0, borderRadius: 7, background: "#f4b942", color: "#101827", padding: "11px 14px", fontWeight: 900, cursor: "pointer" },
  hint: { color: "#9facbf", lineHeight: 1.5, fontSize: 13, margin: "5px 0" }, body: { color: "#d4dceb", lineHeight: 1.5 },
  list: { display: "grid", gap: 12 }, item: { border: "1px solid #34445f", borderRadius: 9, background: "#131e30", padding: 15 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }, badge: { display: "inline-block", borderRadius: 5, padding: "4px 8px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }, approve: { border: 0, borderRadius: 7, background: "#22c55e", color: "#052e16", padding: "8px 11px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 7, background: "transparent", color: "#e2e8f0", padding: "8px 11px", fontWeight: 800, cursor: "pointer" }, danger: { border: "1px solid #f87171", borderRadius: 7, background: "transparent", color: "#fecaca", padding: "8px 11px", fontWeight: 800, cursor: "pointer" },
  review: { color: "#fed7aa", borderLeft: "3px solid #fb923c", paddingLeft: 10, fontSize: 13 }, consent: { borderTop: "1px solid #34445f", marginTop: 12, paddingTop: 10, color: "#dce5f3" },
  link: { color: "#f4b942" }, linkButton: { border: 0, background: "none", color: "#f4b942", cursor: "pointer", fontWeight: 800, marginLeft: 8 },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 14 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 14 }, info: { border: "1px solid #60a5fa", color: "#bfdbfe", borderRadius: 8, padding: 12 }, safety: { color: "#8ea0b8", fontSize: 12, margin: "16px 0 0" }
};
