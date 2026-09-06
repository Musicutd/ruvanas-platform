"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./syndication.module.css";

function localDate(offsetDays = 0) {
  const value = new Date(Date.now() + offsetDays * 86400000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
}

const newOffer = {
  stationNetworkId: "", sourceStationId: "", kind: "RECORDED_PROGRAMME", sourcePodcastEpisodeId: "", sourceChannelId: "",
  title: "", description: "", rightsHolder: "", rightsReference: "", rightsBasis: "DIRECT_LICENCE", permittedTerritories: "WORLDWIDE",
  availableFrom: localDate(), availableUntil: localDate(30)
};

function firstTerritory(value) {
  const first = String(value || "").split(",")[0];
  return first === "WORLDWIDE" ? "MT" : first;
}

export default function SyndicationWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(newOffer);
  const [requestDrafts, setRequestDrafts] = useState({});
  const [working, setWorking] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/radio-syndication", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load syndication.");
      setData(payload);
      setForm((current) => ({ ...current, rightsHolder: current.rightsHolder || payload.organisation.name }));
    } catch (loadError) { setError(loadError.message); } finally { setWorking(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(body, success) {
    setWorking(body.action); setError(""); setNotice("");
    try {
      const response = await fetch("/api/radio-syndication", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The syndication action could not be completed.");
      setNotice(success); await load(); return true;
    } catch (actionError) { setError(actionError.message); return false; } finally { setWorking(""); }
  }

  const membership = useMemo(() => data?.memberships.find((item) => item.network.id === form.stationNetworkId && (!form.sourceStationId || item.station.id === form.sourceStationId)) || null, [data, form.stationNetworkId, form.sourceStationId]);
  const availableMemberships = data?.memberships || [];
  const ownOffers = (data?.offers || []).filter((offer) => offer.ownOffer);
  const catalogue = (data?.offers || []).filter((offer) => !offer.ownOffer && offer.status === "AVAILABLE");

  function requestDraft(offer) {
    const eligible = availableMemberships.find((entry) => entry.network.id === offer.network.id);
    const start = new Date(Math.max(Date.now(), new Date(offer.availableFrom).getTime()));
    start.setMinutes(start.getMinutes() - start.getTimezoneOffset());
    return requestDrafts[offer.id] || {
      targetStationId: eligible?.station.id || "", targetChannelId: "", requestedTerritories: offer.permittedTerritories,
      requestedFrom: start.toISOString().slice(0, 16), requestedUntil: offer.availableUntil ? new Date(new Date(offer.availableUntil).getTime() - new Date(offer.availableUntil).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
      intendedUse: "Broadcast this programme or relay on our approved network station."
    };
  }

  async function create(event) {
    event.preventDefault();
    const success = await act({ action: "CREATE_OFFER", ...form, availableFrom: new Date(form.availableFrom).toISOString(), availableUntil: form.availableUntil ? new Date(form.availableUntil).toISOString() : null, sourcePodcastEpisodeId: form.kind === "RECORDED_PROGRAMME" ? form.sourcePodcastEpisodeId : null, sourceChannelId: form.kind === "LIVE_RELAY" ? form.sourceChannelId : null }, "Draft offer created. Review it, then publish when the rights details are correct.");
    if (success) setForm({ ...newOffer, rightsHolder: data.organisation.name });
  }

  if (working === "load" && !data) return <div className={styles.panel}>Loading rights-controlled syndication…</div>;
  return <div className={styles.workspace}>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    <section className={styles.metrics}>
      <div><strong>{availableMemberships.length}</strong><span>Active network stations</span></div>
      <div><strong>{ownOffers.length}</strong><span>Your offers</span></div>
      <div><strong>{data?.myAgreements.filter((item) => item.status === "APPROVED").length || 0}</strong><span>Approved deliveries</span></div>
    </section>

    {!availableMemberships.length ? <section className={styles.panel}><div className={styles.empty}><h2>Join an active station network first</h2><p>Syndication only opens after both station owners approve network membership.</p><a className={styles.primaryLink} href="/dashboard/radio/networks">Open station networks</a></div></section> : null}

    {data?.permissions.canManage && availableMemberships.length ? <form className={styles.panel} onSubmit={create}>
      <div className={styles.heading}><div><p className={styles.kicker}>CREATE AN OFFER</p><h2>Define the rights before sharing</h2></div><span>Starts as draft</span></div>
      <div className={styles.formGrid}>
        <label><span>Network station</span><select required value={`${form.stationNetworkId}|${form.sourceStationId}`} onChange={(event) => { const [stationNetworkId, sourceStationId] = event.target.value.split("|"); setForm({ ...form, stationNetworkId, sourceStationId, sourcePodcastEpisodeId: "", sourceChannelId: "" }); }}><option value="|">Choose…</option>{availableMemberships.map((item) => <option key={item.id} value={`${item.network.id}|${item.station.id}`}>{item.network.name} · {item.station.name}</option>)}</select></label>
        <label><span>Format</span><select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value, sourcePodcastEpisodeId: "", sourceChannelId: "" })}><option value="RECORDED_PROGRAMME">Recorded programme</option><option value="LIVE_RELAY">Live relay</option></select></label>
        {form.kind === "RECORDED_PROGRAMME" ? <label><span>Published programme</span><select required value={form.sourcePodcastEpisodeId} onChange={(event) => setForm({ ...form, sourcePodcastEpisodeId: event.target.value })}><option value="">Choose…</option>{(data?.eligibleEpisodes || []).filter((item) => item.stationId === form.sourceStationId).map((episode) => <option key={episode.id} value={episode.id}>{episode.title} · {episode.seriesTitle}</option>)}</select></label> : <label><span>Active channel</span><select required value={form.sourceChannelId} onChange={(event) => setForm({ ...form, sourceChannelId: event.target.value })}><option value="">Choose…</option>{(membership?.station.channels || []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>}
        <label><span>Offer title</span><input required maxLength="140" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className={styles.wide}><span>Description</span><textarea maxLength="1000" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label><span>Rights holder</span><input required maxLength="160" value={form.rightsHolder} onChange={(event) => setForm({ ...form, rightsHolder: event.target.value })} /></label>
        <label><span>Rights evidence reference</span><input required maxLength="200" value={form.rightsReference} onChange={(event) => setForm({ ...form, rightsReference: event.target.value })} placeholder="Agreement or licence reference" /></label>
        <label><span>Rights basis</span><select value={form.rightsBasis} onChange={(event) => setForm({ ...form, rightsBasis: event.target.value })}><option value="OWNED_MASTER">Owned master</option><option value="DIRECT_LICENCE">Direct licence</option><option value="DISTRIBUTOR_LICENCE">Distributor licence</option><option value="OTHER">Other documented authority</option></select></label>
        <label><span>Territories</span><input required value={form.permittedTerritories} onChange={(event) => setForm({ ...form, permittedTerritories: event.target.value })} placeholder="WORLDWIDE or MT,GB" /></label>
        <label><span>Rights start</span><input required type="datetime-local" value={form.availableFrom} onChange={(event) => setForm({ ...form, availableFrom: event.target.value })} /></label>
        <label><span>Rights end</span><input type="datetime-local" value={form.availableUntil} onChange={(event) => setForm({ ...form, availableUntil: event.target.value })} /></label>
      </div>
      <div className={styles.actions}><button className={styles.primary} disabled={Boolean(working)}>Create draft offer</button></div>
    </form> : null}

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>YOUR OFFERS</p><h2>Source approvals and control</h2></div><span>{ownOffers.length} offers</span></div>
      <div className={styles.cards}>{ownOffers.length ? ownOffers.map((offer) => <article className={styles.card} key={offer.id}>
        <div className={styles.cardHead}><div><b>{offer.kind === "LIVE_RELAY" ? "LIVE RELAY" : "RECORDED"}</b><h3>{offer.title}</h3><p>{offer.sourceStation.name} · {offer.network.name}</p></div><span className={styles.badge}>{offer.status}</span></div>
        <p>{offer.permittedTerritories} · {new Date(offer.availableFrom).toLocaleString()} → {offer.availableUntil ? new Date(offer.availableUntil).toLocaleString() : "open ended"}</p>
        <div className={styles.actions}>{offer.status === "DRAFT" || offer.status === "PAUSED" ? <button disabled={Boolean(working)} onClick={() => act({ action: "CHANGE_OFFER", offerId: offer.id, offerAction: "PUBLISH" }, "Offer published to eligible network stations.")}>Publish</button> : null}{offer.status === "AVAILABLE" ? <button className={styles.secondary} disabled={Boolean(working)} onClick={() => act({ action: "CHANGE_OFFER", offerId: offer.id, offerAction: "PAUSE" }, "Offer paused. Delivery is now blocked.")}>Pause</button> : null}{offer.status !== "WITHDRAWN" ? <button className={styles.danger} disabled={Boolean(working)} onClick={() => act({ action: "CHANGE_OFFER", offerId: offer.id, offerAction: "WITHDRAW", reason: "Withdrawn by the source organisation." }, "Offer withdrawn and delivery revoked.")}>Withdraw</button> : null}</div>
        <div className={styles.requests}>{offer.agreements.length ? offer.agreements.map((agreement) => <div className={styles.request} key={agreement.id}><div><strong>{agreement.targetStation.name}</strong><span>{agreement.targetOrganisation.name} · {agreement.requestedTerritories}</span><small>{agreement.intendedUse}</small></div><span>{agreement.status}</span><div className={styles.actions}>{agreement.status === "PENDING" ? <><button disabled={Boolean(working)} onClick={() => act({ action: "DECIDE_REQUEST", agreementId: agreement.id, decision: "APPROVE" }, "Receiving station approved.")}>Approve</button><button className={styles.danger} disabled={Boolean(working)} onClick={() => act({ action: "DECIDE_REQUEST", agreementId: agreement.id, decision: "DECLINE", notes: "The requested use is not approved." }, "Request declined.")}>Decline</button></> : agreement.status === "APPROVED" ? <button className={styles.danger} disabled={Boolean(working)} onClick={() => act({ action: "REVOKE_REQUEST", agreementId: agreement.id, reason: "Rights access revoked by the source organisation." }, "Access revoked immediately.")}>Revoke</button> : null}</div></div>) : <p className={styles.muted}>No receiving station has requested this offer.</p>}</div>
      </article>) : <p className={styles.muted}>No offers yet. Create a draft above when you have documented rights.</p>}</div>
    </section>

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>NETWORK CATALOGUE</p><h2>Request content from another station</h2></div><span>{catalogue.length} available</span></div>
      <div className={styles.cards}>{catalogue.length ? catalogue.map((offer) => { const draft = requestDraft(offer); const eligible = availableMemberships.filter((entry) => entry.network.id === offer.network.id); const selected = eligible.find((entry) => entry.station.id === draft.targetStationId); return <article className={styles.card} key={offer.id}>
        <div className={styles.cardHead}><div><b>{offer.kind.replaceAll("_", " ")}</b><h3>{offer.title}</h3><p>{offer.sourceStation.name} · {offer.sourceOrganisation.name}</p></div><span className={styles.badge}>{offer.permittedTerritories}</span></div><p>{offer.description || "No additional description."}</p>
        <div className={styles.formGrid}><label><span>Receiving station</span><select value={draft.targetStationId} onChange={(event) => setRequestDrafts({ ...requestDrafts, [offer.id]: { ...draft, targetStationId: event.target.value, targetChannelId: "" } })}>{eligible.map((entry) => <option key={entry.id} value={entry.station.id}>{entry.station.name}</option>)}</select></label><label><span>Receiving channel (optional)</span><select value={draft.targetChannelId} onChange={(event) => setRequestDrafts({ ...requestDrafts, [offer.id]: { ...draft, targetChannelId: event.target.value } })}><option value="">Choose later</option>{(selected?.station.channels || []).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label><span>Territories</span><input value={draft.requestedTerritories} onChange={(event) => setRequestDrafts({ ...requestDrafts, [offer.id]: { ...draft, requestedTerritories: event.target.value } })} /></label><label><span>Start</span><input type="datetime-local" value={draft.requestedFrom} onChange={(event) => setRequestDrafts({ ...requestDrafts, [offer.id]: { ...draft, requestedFrom: event.target.value } })} /></label><label><span>End</span><input type="datetime-local" value={draft.requestedUntil} onChange={(event) => setRequestDrafts({ ...requestDrafts, [offer.id]: { ...draft, requestedUntil: event.target.value } })} /></label><label className={styles.wide}><span>Intended use</span><textarea value={draft.intendedUse} onChange={(event) => setRequestDrafts({ ...requestDrafts, [offer.id]: { ...draft, intendedUse: event.target.value } })} /></label></div>
        <div className={styles.actions}><button disabled={Boolean(working)} onClick={() => act({ action: "REQUEST_ACCESS", offerId: offer.id, ...draft, requestedFrom: new Date(draft.requestedFrom).toISOString(), requestedUntil: draft.requestedUntil ? new Date(draft.requestedUntil).toISOString() : null, targetChannelId: draft.targetChannelId || null }, "Rights request sent to the source organisation.")}>Request access</button></div>
      </article>; }) : <p className={styles.muted}>No other station currently has an available offer in your networks.</p>}</div>
    </section>

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>RECEIVING</p><h2>Your requested deliveries</h2></div><span>{data?.myAgreements.length || 0} agreements</span></div>
      <div className={styles.cards}>{data?.myAgreements.length ? data.myAgreements.map((agreement) => <article className={styles.card} key={agreement.id}><div className={styles.cardHead}><div><b>{agreement.offer.kind.replaceAll("_", " ")}</b><h3>{agreement.offer.title}</h3><p>{agreement.offer.sourceStation.name} · {agreement.offer.network.name}</p></div><span className={styles.badge}>{agreement.status}</span></div><p>{agreement.requestedTerritories} · {new Date(agreement.requestedFrom).toLocaleString()} → {agreement.requestedUntil ? new Date(agreement.requestedUntil).toLocaleString() : "open ended"}</p><div className={styles.actions}>{agreement.status === "PENDING" ? <button className={styles.danger} disabled={Boolean(working)} onClick={() => act({ action: "CANCEL_REQUEST", agreementId: agreement.id }, "Request cancelled.")}>Cancel request</button> : agreement.status === "APPROVED" && !agreement.importedAt ? <button disabled={Boolean(working)} onClick={() => act({ action: "ACTIVATE_REQUEST", agreementId: agreement.id }, "Syndication delivery activated for your station.")}>Activate delivery</button> : null}</div>{agreement.delivery?.recordedPath ? <audio className={styles.audio} controls preload="none" src={`${agreement.delivery.recordedPath}?territory=${firstTerritory(agreement.requestedTerritories)}`} /> : null}{agreement.delivery?.livePath ? <audio className={styles.audio} controls preload="none" src={`${agreement.delivery.livePath}?territory=${firstTerritory(agreement.requestedTerritories)}`} /> : null}</article>) : <p className={styles.muted}>No syndication requests have been made by this organisation.</p>}</div>
    </section>
  </div>;
}
