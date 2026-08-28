"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function Metric({ label, value }) {
  return <div style={styles.metric}><strong style={styles.metricValue}>{value}</strong><span style={styles.metricLabel}>{label}</span></div>;
}

export default function AcademyWorkspaceClient() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [networkName, setNetworkName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [member, setMember] = useState({ email: "", role: "VIEWER" });
  const [grant, setGrant] = useState({ networkMemberId: "", organisationId: "", organisationRole: "VIEWER" });

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/network", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The academy workspace could not be loaded.");
    setData(payload);
    setSelectedId((current) => payload.networks.some((item) => item.id === current) ? current : payload.networks[0]?.id || "");
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);
  const selected = useMemo(() => data?.networks.find((item) => item.id === selectedId) || null, [data, selectedId]);

  async function act(body, success) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The academy action could not be completed.");
      setNotice(success);
      await load();
      return true;
    } catch (actionError) {
      setError(actionError.message);
      return false;
    } finally { setWorking(false); }
  }

  async function createNetwork(event) {
    event.preventDefault();
    if (await act({ action: "CREATE_NETWORK", name: networkName }, "Academy network created.")) setNetworkName("");
  }

  async function addSchool(event) {
    event.preventDefault();
    if (await act({ action: "ADD_SCHOOL", schoolNetworkId: selected.id, organisationId: schoolId }, "School added to the academy network.")) setSchoolId("");
  }

  async function addMember(event) {
    event.preventDefault();
    if (await act({ action: "ADD_MEMBER", schoolNetworkId: selected.id, ...member }, "Academy member assigned.")) setMember({ email: "", role: "VIEWER" });
  }

  async function grantAccess(event) {
    event.preventDefault();
    if (await act({ action: "GRANT_SCHOOL_ACCESS", schoolNetworkId: selected.id, ...grant }, "Explicit school access granted.")) setGrant({ networkMemberId: "", organisationId: "", organisationRole: "VIEWER" });
  }

  async function switchSchool(organisationId) {
    if (await act({ action: "SWITCH_SCHOOL", schoolNetworkId: selected.id, organisationId }, "Opening the selected school…")) window.location.assign("/dashboard/school-radio");
  }

  async function toggleSchool(school) {
    await act({ action: "SET_SCHOOL_STATUS", schoolNetworkId: selected.id, networkSchoolId: school.id, active: !school.active }, school.active ? "School paused in the network." : "School reactivated in the network.");
  }

  if (!data) return <section style={styles.card}><p style={styles.eyebrow}>STAGE 5B · ACADEMY ADMINISTRATION</p><p style={styles.hint}>{error || "Loading academy scope…"}</p></section>;

  return <section style={styles.workspace} aria-label="Academy administration">
    <div style={styles.headingRow}>
      <div><p style={styles.eyebrow}>STAGE 5B · ACADEMY ADMINISTRATION</p><h2 style={styles.title}>Oversee schools without crossing their boundaries</h2><p style={styles.hint}>Network summaries contain aggregate operational counts only. Opening a school still requires an explicit organisation membership.</p></div>
      <span style={styles.badge}>REDACTED ROLL-UP</span>
    </div>
    {error ? <div style={styles.error}>{error}</div> : null}
    {notice ? <div style={styles.notice}>{notice}</div> : null}

    {data.platformRole === "SUPER_ADMIN" && !data.networks.length ? <form onSubmit={createNetwork} style={styles.card}>
      <h3 style={styles.cardTitle}>Create the first academy network</h3>
      <label style={styles.label}>Academy or school-group name<input style={styles.input} value={networkName} onChange={(event) => setNetworkName(event.target.value)} minLength={2} maxLength={160} required /></label>
      <button style={styles.primary} disabled={working}>Create academy network</button>
    </form> : null}

    {!data.networks.length && data.platformRole !== "SUPER_ADMIN" ? <div style={styles.card}><h3 style={styles.cardTitle}>No academy scope assigned</h3><p style={styles.hint}>Your current school workspace remains unchanged. A Ruvanas administrator can add your account to an academy network later.</p></div> : null}

    {data.networks.length ? <>
      <label style={styles.label}>Academy network<select style={styles.input} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{data.networks.map((network) => <option key={network.id} value={network.id}>{network.name} · {network.role}</option>)}</select></label>
      <div style={styles.schoolGrid}>{selected?.schools.map((school) => <article key={school.id} style={{ ...styles.card, opacity: school.active ? 1 : 0.7 }}>
        <div style={styles.itemHeader}><div><h3 style={styles.cardTitle}>{school.name}</h3><p style={styles.hint}>{school.active ? "Active academy school" : "Paused in academy scope"}</p></div><span style={school.active ? styles.activeBadge : styles.pausedBadge}>{school.active ? "ACTIVE" : "PAUSED"}</span></div>
        <div style={styles.metrics}><Metric label="Locations" value={school.metrics.locations} /><Metric label="Classes" value={school.metrics.classes} /><Metric label="Programmes" value={school.metrics.programmes} /><Metric label="Episodes" value={school.metrics.episodes} /><Metric label="Assignments" value={school.metrics.assignments} /></div>
        <div style={styles.actions}>{school.active && school.canOpen ? <button style={styles.primary} disabled={working} onClick={() => switchSchool(school.organisationId)}>Open school workspace</button> : <span style={styles.restricted}>{school.active ? "Explicit school access required" : "School paused"}</span>}{selected.canManage ? <button style={styles.secondary} disabled={working} onClick={() => toggleSchool(school)}>{school.active ? "Pause in network" : "Reactivate"}</button> : null}</div>
      </article>)}</div>
      {!selected?.schools.length ? <p style={styles.hint}>No schools have been assigned to this academy network.</p> : null}

      {selected?.canManage ? <div style={styles.formGrid}>
        {data.platformRole === "SUPER_ADMIN" ? <form onSubmit={addSchool} style={styles.card}><h3 style={styles.cardTitle}>Attach a School Radio organisation</h3><label style={styles.label}>School<select style={styles.input} value={schoolId} onChange={(event) => setSchoolId(event.target.value)} required><option value="">Choose an unassigned school…</option>{data.candidateSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label><button style={styles.primary} disabled={working || !data.candidateSchools.length}>Add school</button></form> : null}
        <form onSubmit={addMember} style={styles.card}><h3 style={styles.cardTitle}>Assign academy staff</h3><label style={styles.label}>Existing Ruvanas account email<input type="email" style={styles.input} value={member.email} onChange={(event) => setMember((current) => ({ ...current, email: event.target.value }))} required /></label><label style={styles.label}>Network role<select style={styles.input} value={member.role} onChange={(event) => setMember((current) => ({ ...current, role: event.target.value }))}><option value="VIEWER">Viewer</option><option value="ADMIN">Administrator</option>{selected.role === "OWNER" || data.platformRole === "SUPER_ADMIN" ? <option value="OWNER">Owner</option> : null}</select></label><button style={styles.primary} disabled={working}>Assign network role</button></form>
        <form onSubmit={grantAccess} style={styles.card}><h3 style={styles.cardTitle}>Grant explicit school access</h3><label style={styles.label}>Academy member<select style={styles.input} value={grant.networkMemberId} onChange={(event) => setGrant((current) => ({ ...current, networkMemberId: event.target.value }))} required><option value="">Choose member…</option>{selected.members.map((item) => <option key={item.id} value={item.id}>{item.user?.name || item.user?.email} · {item.role}</option>)}</select></label><label style={styles.label}>School<select style={styles.input} value={grant.organisationId} onChange={(event) => setGrant((current) => ({ ...current, organisationId: event.target.value }))} required><option value="">Choose active school…</option>{selected.schools.filter((school) => school.active).map((school) => <option key={school.organisationId} value={school.organisationId}>{school.name}</option>)}</select></label><label style={styles.label}>School role<select style={styles.input} value={grant.organisationRole} onChange={(event) => setGrant((current) => ({ ...current, organisationRole: event.target.value }))}><option value="VIEWER">Viewer</option><option value="CONTENT_EDITOR">Content editor</option><option value="MANAGER">Manager</option></select></label><button style={styles.primary} disabled={working || !selected.members.length || !selected.schools.some((school) => school.active)}>Grant access</button></form>
      </div> : null}
    </> : null}
    <p style={styles.safety}>Safety boundary: aggregate counts only · no cross-school student identities · no self-signup · no private messaging · every scope change is audited.</p>
  </section>;
}

const styles = {
  workspace: { border: "1px solid #395071", borderRadius: 16, background: "#111d2f", padding: 22, marginBottom: 20 },
  headingRow: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 18 },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.2, margin: "0 0 8px" },
  title: { fontSize: 28, margin: "0 0 8px" },
  hint: { color: "#aebbd0", lineHeight: 1.5, fontSize: 13, margin: "6px 0" },
  badge: { border: "1px solid #60a5fa", borderRadius: 999, color: "#bfdbfe", padding: "6px 10px", fontSize: 11, fontWeight: 900 },
  activeBadge: { color: "#bbf7d0", background: "#14532d", borderRadius: 6, padding: "5px 8px", fontSize: 11, fontWeight: 900 },
  pausedBadge: { color: "#cbd5e1", background: "#334155", borderRadius: 6, padding: "5px 8px", fontSize: 11, fontWeight: 900 },
  card: { border: "1px solid #34445f", borderRadius: 12, background: "#182235", padding: 18 },
  cardTitle: { margin: "0 0 12px", fontSize: 18 },
  schoolGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14, margin: "16px 0" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 18 },
  itemHeader: { display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" },
  metrics: { display: "grid", gridTemplateColumns: "repeat(5,minmax(58px,1fr))", gap: 8, margin: "16px 0" },
  metric: { background: "#111827", borderRadius: 8, padding: "9px 6px", textAlign: "center" },
  metricValue: { display: "block", fontSize: 18, color: "#fff" }, metricLabel: { display: "block", color: "#94a3b8", fontSize: 10, marginTop: 3 },
  label: { display: "grid", gap: 7, marginBottom: 13, color: "#dce5f3", fontWeight: 800, fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" },
  secondary: { border: "1px solid #94a3b8", borderRadius: 8, background: "transparent", color: "#e2e8f0", padding: "9px 12px", fontWeight: 800, cursor: "pointer" },
  restricted: { color: "#fcd34d", fontSize: 12, fontWeight: 800 },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 11, marginBottom: 14 },
  notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 11, marginBottom: 14 },
  safety: { color: "#8ea0b8", fontSize: 12, margin: "18px 0 0" }
};

