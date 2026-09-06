"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmActionButton from "@/app/components/ConfirmActionButton";
import styles from "./networks.module.css";

const emptyNetwork = { name: "", description: "" };

export default function StationNetworkWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(emptyNetwork);
  const [inviteSlugs, setInviteSlugs] = useState({});
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/radio-networks", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load station networks.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function request(path, options, successMessage) {
    setBusy(path); setError(""); setNotice("");
    try {
      const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update the station network.");
      setNotice(successMessage); await load(); return true;
    } catch (requestError) { setError(requestError.message); return false; } finally { setBusy(""); }
  }

  async function createNetwork(event) {
    event.preventDefault();
    if (await request("/api/radio-networks", { method: "POST", body: JSON.stringify(form) }, "Network created. Add your own station or invite an independently owned station.")) setForm(emptyNetwork);
  }

  async function invite(networkId, stationSlug) {
    const slug = String(stationSlug || "").trim();
    if (!slug) { setError("Enter the exact station slug supplied by its owner."); return; }
    if (await request(`/api/radio-networks/${networkId}/agreements`, { method: "POST", body: JSON.stringify({ stationSlug: slug }) }, "Station membership invitation recorded.")) setInviteSlugs({ ...inviteSlugs, [networkId]: "" });
  }

  const networks = data?.networks || [];
  if (busy === "load" && !data) return <div className={styles.panel}>Loading station networks…</div>;
  return <div className={styles.workspace}>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    <section className={styles.summary}>
      <div><strong>{networks.length}</strong><span>Visible networks</span></div>
      <div><strong>{networks.reduce((total, network) => total + network.counts.active, 0)}</strong><span>Active station memberships</span></div>
      <div><strong>{networks.reduce((total, network) => total + network.counts.invited, 0)}</strong><span>Awaiting owner decision</span></div>
    </section>
    {data?.permissions.canCreate ? <form className={styles.panel} onSubmit={createNetwork}>
      <div className={styles.heading}><div><p className={styles.kicker}>CREATE A NETWORK</p><h2>Start with a clear owner</h2></div><span>Owner approval required</span></div>
      <p className={styles.intro}>Your organisation will operate the network. Joining stations remain under their existing owners and plans.</p>
      <div className={styles.formGrid}><label><span>Network name</span><input required maxLength="100" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Malta Independent Radio Network" /></label><label><span>Purpose (optional)</span><input maxLength="500" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="A short description for invited station owners" /></label></div>
      <div className={styles.actions}><button className={styles.primary} disabled={busy !== ""}>{busy === "/api/radio-networks" ? "Creating…" : "Create network"}</button></div>
    </form> : null}
    {networks.length ? networks.map((network) => <section className={styles.panel} key={network.id}>
      <div className={styles.heading}><div><p className={styles.kicker}>{network.role.replaceAll("_", " ")}</p><h2>{network.name}</h2><p>{network.description || `Operated by ${network.ownerOrganisation.name}.`}</p></div><span className={styles[network.status.toLowerCase()]}>{network.status}</span></div>
      <div className={styles.networkStats}><span><b>{network.counts.active}</b> active</span><span><b>{network.counts.invited}</b> invited</span><span><b>{network.counts.total}</b> recorded</span></div>
      {network.permissions.canManage && network.status !== "ARCHIVED" ? <div className={styles.inviteBox}>
        <div><strong>Add or invite a station</strong><span>Use its exact public station slug. An external station stays pending until its organisation owner accepts.</span></div>
        <div className={styles.inviteForm}><input aria-label={`Station slug for ${network.name}`} value={inviteSlugs[network.id] || ""} onChange={(event) => setInviteSlugs({ ...inviteSlugs, [network.id]: event.target.value })} placeholder="station-public-slug" /><button className={styles.primary} type="button" disabled={busy !== "" || network.status !== "ACTIVE"} onClick={() => invite(network.id, inviteSlugs[network.id])}>Add or invite</button></div>
        {data.ownStations?.length ? <div className={styles.ownStations}><span>Your stations:</span>{data.ownStations.filter((station) => station.status === "ACTIVE").map((station) => <button type="button" key={station.id} onClick={() => setInviteSlugs({ ...inviteSlugs, [network.id]: station.slug })}>{station.name}</button>)}</div> : null}
      </div> : null}
      <div className={styles.agreements}>
        {network.agreements.length ? network.agreements.map((agreement) => {
          const isOwnStation = agreement.organisation.id === data.organisation.id;
          return <article className={styles.agreement} key={agreement.id}>
            <div><strong>{agreement.station.name}</strong><span>{agreement.organisation.name} · {agreement.station.slug}</span></div>
            <span className={styles[agreement.status.toLowerCase()]}>{agreement.status}</span>
            <div className={styles.rowActions}>
              {isOwnStation && network.permissions.canApproveForStation && agreement.status === "INVITED" ? <><button className={styles.primary} type="button" disabled={busy !== ""} onClick={() => request(`/api/radio-networks/${network.id}/agreements/${agreement.id}`, { method: "PATCH", body: JSON.stringify({ action: "ACCEPT" }) }, "Network membership accepted.")}>Accept</button><button className={styles.danger} type="button" disabled={busy !== ""} onClick={() => request(`/api/radio-networks/${network.id}/agreements/${agreement.id}`, { method: "PATCH", body: JSON.stringify({ action: "DECLINE" }) }, "Network invitation declined.")}>Decline</button></> : null}
              {isOwnStation && network.permissions.canApproveForStation && agreement.status === "ACTIVE" && network.role !== "NETWORK_OPERATOR" ? <ConfirmActionButton className={styles.danger} disabled={busy !== ""} title={`Leave ${network.name}?`} message="This station will immediately lose participant visibility. Its audio, audience data and programming remain unchanged, and the decision stays in the audit record." confirmLabel="Leave network" onConfirm={() => request(`/api/radio-networks/${network.id}/agreements/${agreement.id}`, { method: "PATCH", body: JSON.stringify({ action: "LEAVE" }) }, "The station has left the network.")}>Leave network</ConfirmActionButton> : null}
              {network.permissions.canManage && ["INVITED", "ACTIVE"].includes(agreement.status) ? <ConfirmActionButton className={styles.danger} disabled={busy !== ""} title={`Remove ${agreement.station.name}?`} message="The station will immediately lose network membership or its pending invitation. Its independent service and data will not be changed." confirmLabel="Remove station" onConfirm={() => request(`/api/radio-networks/${network.id}/agreements/${agreement.id}`, { method: "PATCH", body: JSON.stringify({ action: "REVOKE" }) }, "Station membership removed by the network operator.")}>Remove</ConfirmActionButton> : null}
            </div>
          </article>;
        }) : <div className={styles.empty}>No stations have been added. Start with one of your own active stations or invite another station by its slug.</div>}
      </div>
      {network.permissions.canManage ? <div className={styles.actions}>
        {network.status === "ACTIVE" ? <button className={styles.secondary} type="button" disabled={busy !== ""} onClick={() => request(`/api/radio-networks/${network.id}`, { method: "PATCH", body: JSON.stringify({ status: "PAUSED" }) }, "Network paused. Existing station memberships remain recorded.")}>Pause invitations</button> : network.status === "PAUSED" ? <button className={styles.secondary} type="button" disabled={busy !== ""} onClick={() => request(`/api/radio-networks/${network.id}`, { method: "PATCH", body: JSON.stringify({ status: "ACTIVE" }) }, "Network resumed.")}>Resume network</button> : null}
        {network.status !== "ARCHIVED" && data.organisation.role === "OWNER" ? <ConfirmActionButton className={styles.danger} disabled={busy !== ""} title={`Archive ${network.name}?`} message="Invitations will stop and the network becomes read-only. Station services remain independent and unchanged; membership and audit history are retained." confirmLabel="Archive network" onConfirm={() => request(`/api/radio-networks/${network.id}`, { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }, "Network archived. Membership history remains available.")}>Archive network</ConfirmActionButton> : null}
      </div> : null}
    </section>) : <section className={styles.panel}><div className={styles.empty}>No station networks are visible to this organisation yet.</div></section>}
  </div>;
}
