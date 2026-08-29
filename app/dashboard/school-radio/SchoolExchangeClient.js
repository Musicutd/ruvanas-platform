"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function formatDuration(seconds) {
  if (!seconds) return "Duration unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function Badge({ value }) {
  const colours = {
    AVAILABLE: ["#dcfce7", "#166534"], APPROVED: ["#dcfce7", "#166534"],
    PENDING: ["#fef3c7", "#92400e"], PAUSED: ["#e0e7ff", "#3730a3"],
    DECLINED: ["#fee2e2", "#991b1b"], REVOKED: ["#fee2e2", "#991b1b"],
    WITHDRAWN: ["#e2e8f0", "#475569"], CANCELLED: ["#e2e8f0", "#475569"]
  };
  const [background, color] = colours[value] || ["#e2e8f0", "#334155"];
  return <span style={{ ...s.badge, background, color }}>{String(value).replaceAll("_", " ")}</span>;
}

export default function SchoolExchangeClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [episodeId, setEpisodeId] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [intendedUse, setIntendedUse] = useState({});

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/network/exchange", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The School Network exchange could not be loaded.");
    setData(payload);
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);
  const requestsByOffer = useMemo(() => new Map((data?.myRequests || []).map((request) => [request.offerId, request])), [data]);

  async function act(body, success) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/network/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The School Network exchange action could not be completed.");
      setNotice(success); await load(); return true;
    } catch (actionError) { setError(actionError.message); return false; } finally { setWorking(false); }
  }

  async function publishOffer(event) {
    event.preventDefault();
    if (await act({ action: "PUBLISH_OFFER", episodeId, consentConfirmed }, "Approved episode added to the private network library.")) {
      setEpisodeId(""); setConsentConfirmed(false);
    }
  }

  async function changeOffer(offer, offerAction) {
    let reason = null;
    if (offerAction === "WITHDRAW") {
      reason = window.prompt("Why is this episode being withdrawn from the network library?", "");
      if (!reason?.trim()) return;
    }
    await act({ action: "CHANGE_OFFER", offerId: offer.id, offerAction, reason }, `Episode offer ${offerAction.toLowerCase()}d.`);
  }

  async function requestAccess(offer) {
    await act({ action: "REQUEST_ACCESS", offerId: offer.id, intendedUse: intendedUse[offer.id] || "" }, "Access request sent to the source school.");
  }

  async function decideRequest(request, decision) {
    let notes = null;
    if (decision === "DECLINE") {
      notes = window.prompt("Why is this request being declined?", "");
      if (!notes?.trim()) return;
    }
    await act({ action: "DECIDE_REQUEST", requestId: request.id, decision, notes }, `Exchange request ${decision.toLowerCase()}d.`);
  }

  async function revokeRequest(request) {
    const reason = window.prompt("Why is this school’s access being revoked? Future scheduled playback will be cancelled.", "");
    if (!reason?.trim()) return;
    await act({ action: "REVOKE_REQUEST", requestId: request.id, reason }, "Exchange access revoked and future playback disabled.");
  }

  if (!data) return <section style={s.section}><p style={s.hint}>{error || "Loading School Network exchange…"}</p></section>;
  if (!data.network) return <section style={s.section}><p style={s.eyebrow}>STAGE 8B · VERIFIED SCHOOL EXCHANGE</p><h2 style={s.title}>Private sharing between approved schools</h2><p style={s.hint}>Add this school to an active academy network before enabling cross-school episode exchange.</p></section>;

  return <section style={s.section}>
    <div style={s.heading}><div><p style={s.eyebrow}>STAGE 8B · VERIFIED SCHOOL EXCHANGE</p><h2 style={s.title}>Approved episodes, shared with two-school control</h2><p style={s.hint}>{data.network.name} · {data.network.schools.length} verified schools. Source and receiving staff approve every exchange; the receiving school must review imported audio again before scheduling it.</p></div><span style={s.safety}>NO STUDENT FEED</span></div>
    {error ? <div style={s.error}>{error}</div> : null}{notice ? <div style={s.notice}>{notice}</div> : null}

    {data.permissions.canManage ? <form onSubmit={publishOffer} style={s.form}>
      <label style={s.label}>Approved episode<select style={s.input} value={episodeId} onChange={(event) => setEpisodeId(event.target.value)} required><option value="">Choose approved episode…</option>{data.eligibleEpisodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.title} · {formatDuration(episode.durationSeconds)}</option>)}</select></label>
      <label style={s.check}><input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} required /><span>I confirm the episode is approved for cross-school use and every student contributor has a current consent record.</span></label>
      <button style={s.primary} disabled={working || !episodeId || !consentConfirmed}>Offer to verified schools</button>
      {!data.eligibleEpisodes.length ? <p style={s.hint}>No additional approved episodes are currently eligible for sharing.</p> : null}
    </form> : <p style={s.hint}>Owners and managers control episode sharing. Staff can view the network library and request history.</p>}

    <div style={s.library}>{!data.offers.length ? <p style={s.hint}>The private network library is empty.</p> : data.offers.map((offer) => {
      const myRequest = requestsByOffer.get(offer.id);
      return <article key={offer.id} style={s.card}>
        <div style={s.cardHeading}><div><h3 style={s.itemTitle}>{offer.title}</h3><p style={s.meta}>{offer.sourceSchool.name} · {formatDuration(offer.durationSeconds)} · {offer.languageCode}</p></div><Badge value={offer.status} /></div>
        {offer.summary ? <p style={s.body}>{offer.summary}</p> : null}
        {offer.ownOffer ? <>
          {data.permissions.canManage && offer.status !== "WITHDRAWN" ? <div style={s.actions}>{offer.status === "AVAILABLE" ? <button style={s.secondary} disabled={working} onClick={() => changeOffer(offer, "PAUSE")}>Pause offer</button> : <button style={s.secondary} disabled={working} onClick={() => changeOffer(offer, "RESUME")}>Resume offer</button>}<button style={s.danger} disabled={working} onClick={() => changeOffer(offer, "WITHDRAW")}>Withdraw</button></div> : null}
          <div style={s.requests}>{!offer.requests.length ? <p style={s.hint}>No schools have requested this episode.</p> : offer.requests.map((request) => <div key={request.id} style={s.request}><div><strong>{request.targetSchool.name}</strong><p style={s.hint}>{request.intendedUse}</p>{request.decisionNotes ? <p style={s.decision}>Decision note: {request.decisionNotes}</p> : null}</div><div style={s.requestControls}><Badge value={request.status} />{data.permissions.canManage && request.status === "PENDING" ? <><button style={s.approve} disabled={working} onClick={() => decideRequest(request, "APPROVE")}>Approve</button><button style={s.danger} disabled={working} onClick={() => decideRequest(request, "DECLINE")}>Decline</button></> : null}{data.permissions.canManage && request.status === "APPROVED" ? <button style={s.danger} disabled={working} onClick={() => revokeRequest(request)}>Revoke</button> : null}</div></div>)}</div>
        </> : myRequest ? <div style={s.requestSummary}><p style={s.hint}>Your request: {myRequest.intendedUse}</p><Badge value={myRequest.status} />{myRequest.decisionNotes ? <p style={s.decision}>{myRequest.decisionNotes}</p> : null}{data.permissions.canManage && myRequest.status === "PENDING" ? <button style={s.secondary} disabled={working} onClick={() => act({ action: "CANCEL_REQUEST", requestId: myRequest.id }, "Exchange request cancelled.")}>Cancel request</button> : null}{data.permissions.canManage && myRequest.status === "APPROVED" && (!myRequest.importedAnnouncement || myRequest.importedAnnouncement.status === "ARCHIVED") ? <button style={s.primary} disabled={working} onClick={() => act({ action: "IMPORT_REQUEST", requestId: myRequest.id }, "Episode imported and submitted for local review.")}>{myRequest.importedAnnouncement ? "Re-import for local review" : "Import for local review"}</button> : null}{myRequest.importedAnnouncement ? <p style={s.imported}>Imported announcement: {myRequest.importedAnnouncement.status.replaceAll("_", " ")}</p> : null}</div> : data.permissions.canManage ? <div style={s.requestForm}><label style={s.label}>How will your school use this episode?<textarea style={{ ...s.input, minHeight: 82 }} maxLength={500} value={intendedUse[offer.id] || ""} onChange={(event) => setIntendedUse((current) => ({ ...current, [offer.id]: event.target.value }))} placeholder="For example: a supervised lunchtime programme for Year 8 media studies." /></label><button style={s.primary} disabled={working || (intendedUse[offer.id] || "").trim().length < 20} onClick={() => requestAccess(offer)}>Request access</button></div> : <p style={s.hint}>A manager can request this episode for your school.</p>}
      </article>;
    })}</div>
    <p style={s.privacy}>Safety boundary: verified schools only · two-school approval · current consent check · redacted metadata · local re-review · revocable playback · no student identities or direct messaging.</p>
  </section>;
}

const s = {
  section: { border: "1px solid #0f766e", borderRadius: 14, background: "#102b2b", padding: 22, marginBottom: 20 },
  heading: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 18 },
  eyebrow: { color: "#5eead4", fontSize: 12, fontWeight: 900, letterSpacing: 1.2, margin: "0 0 8px" },
  title: { margin: 0, fontSize: 26 }, hint: { color: "#a7c7c4", lineHeight: 1.5, fontSize: 13 },
  safety: { border: "1px solid #14b8a6", borderRadius: 6, padding: "5px 8px", color: "#99f6e4", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" },
  form: { display: "grid", gap: 12, border: "1px solid #285a58", borderRadius: 10, padding: 16, marginBottom: 18 },
  label: { display: "grid", gap: 7, color: "#e2e8f0", fontWeight: 800, fontSize: 13 },
  input: { width: "100%", boxSizing: "border-box", border: "1px solid #64748b", borderRadius: 8, padding: "10px 11px", background: "#fff", color: "#111827", font: "inherit" },
  check: { display: "flex", gap: 9, alignItems: "flex-start", color: "#ccfbf1", fontSize: 13, lineHeight: 1.45 },
  primary: { border: 0, borderRadius: 8, padding: "11px 14px", background: "#14b8a6", color: "#042f2e", fontWeight: 900, cursor: "pointer" },
  secondary: { border: "1px solid #5eead4", borderRadius: 7, background: "transparent", color: "#ccfbf1", padding: "8px 10px", fontWeight: 800, cursor: "pointer" },
  danger: { border: "1px solid #f87171", borderRadius: 7, background: "transparent", color: "#fecaca", padding: "8px 10px", fontWeight: 800, cursor: "pointer" },
  approve: { border: 0, borderRadius: 7, background: "#22c55e", color: "#052e16", padding: "8px 10px", fontWeight: 900, cursor: "pointer" },
  library: { display: "grid", gap: 12 }, card: { border: "1px solid #285a58", borderRadius: 10, background: "#0d2225", padding: 16 },
  cardHeading: { display: "flex", justifyContent: "space-between", gap: 12 }, itemTitle: { margin: "0 0 5px" }, meta: { color: "#5eead4", fontSize: 12, fontWeight: 800 }, body: { color: "#d8eeee", lineHeight: 1.5 },
  badge: { display: "inline-block", borderRadius: 5, padding: "4px 8px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap", height: "fit-content" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }, requests: { display: "grid", gap: 9, marginTop: 14 }, request: { borderTop: "1px solid #285a58", paddingTop: 11, display: "flex", justifyContent: "space-between", gap: 12 }, requestControls: { display: "flex", gap: 7, flexWrap: "wrap", alignItems: "flex-start", justifyContent: "flex-end" },
  requestForm: { display: "grid", gap: 10, marginTop: 12 }, requestSummary: { display: "grid", gap: 9, marginTop: 12 }, decision: { color: "#fdba74", fontSize: 13 }, imported: { color: "#86efac", fontWeight: 800, fontSize: 13 },
  error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 12 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 12 },
  privacy: { color: "#8fbab6", fontSize: 12, margin: "18px 0 0" }
};
