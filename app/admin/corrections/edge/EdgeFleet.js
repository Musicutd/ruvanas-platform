"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../../dashboard/corrections/network/network.module.css";

const when = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not yet";

export default function EdgeFleet({ facilities }) {
  const [nodes, setNodes] = useState([]);
  const [facilityId, setFacilityId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [oneTime, setOneTime] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/corrections/edge", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Edge fleet could not be loaded.");
      setNodes(result.nodes);
    } catch (error) { setNotice(error.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const create = async (event) => {
    event.preventDefault();
    const facility = facilities.find((item) => item.id === facilityId);
    if (!facility) return;
    setBusy(true); setNotice(""); setOneTime(null);
    try {
      const response = await fetch("/api/admin/corrections/edge", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: facility.organisationId, facilityId, name }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Edge enrolment could not be created.");
      setOneTime({ label: "One-time enrolment credential", secret: result.enrolmentCredential,
        note: `Expires ${when(result.expiresAt)}. Give it only to the authorised Edge operator.` });
      setName(""); await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  const act = async (node, action) => {
    const warning = action === "ROTATE_CREDENTIAL" ?
      `Rotate ${node.name}'s credential now? Its current credential stops working immediately. Save the replacement securely before leaving this page.` :
      `${action === "DECOMMISSION" ? "Decommission" : "Revoke"} ${node.name}? It will lose cloud access immediately. Local encrypted cache and keys must be removed at the facility.`;
    if (!window.confirm(warning)) return;
    setBusy(true); setNotice(""); setOneTime(null);
    try {
      const response = await fetch(`/api/admin/corrections/edge/${encodeURIComponent(node.id)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Edge action was not completed.");
      if (result.machineCredential) setOneTime({ label: "Replacement machine credential", secret: result.machineCredential,
        note: "The previous credential is revoked. Provision this replacement through the approved secure channel." });
      else setNotice(`${node.name}: ${result.status}. Verify local cached media and key removal during decommission.`);
      await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  };
  return <main className={styles.page}>
    <header className={styles.hero}><span className={styles.eyebrow}>Super Admin · Ruvanas Inside</span>
      <h1>Secure Edge control centre</h1><p>Enrol one restricted machine per facility, inspect health, and revoke access. This page never opens decrypted music.</p>
      <a href="/admin">← Super Admin</a></header>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {oneTime && <section className={styles.card} role="status"><h2>{oneTime.label}</h2>
      <p>{oneTime.note}</p><code style={{ overflowWrap: "anywhere" }}>{oneTime.secret}</code>
      <p><button type="button" onClick={() => setOneTime(null)}>I have stored this securely · hide it</button></p>
      <p className={styles.note}>This secret is shown only now; it is not returned by the fleet list.</p></section>}
    <section className={styles.card}><span className={styles.eyebrow}>Controlled enrolment</span><h2>Prepare a facility Edge</h2>
      <form onSubmit={create}><div className={styles.fields}>
        <label>Corrections facility<select required value={facilityId} onChange={(event) => setFacilityId(event.target.value)}>
          <option value="">Choose facility</option>{facilities.map((facility) =>
            <option value={facility.id} key={facility.id}>{facility.organisationName} · {facility.name}</option>)}</select></label>
        <label>Machine name<input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Facility A secure Edge" /></label></div>
        <button disabled={busy || !facilityId || !name.trim()}>Create 15-minute enrolment</button></form>
      <p className={styles.note}>Only a Super Admin can enrol or rotate a machine. The Edge must also present its own Ed25519 proof public key during one-time enrolment.</p></section>
    <section className={styles.card}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>Fleet health</span><h2>Facility Edge nodes</h2></div>
      <button type="button" disabled={busy} onClick={refresh}>Refresh</button></div>
      {!nodes.length ? <p>No Edge nodes prepared.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Organisation / facility</th>
        <th>Node</th><th>Status</th><th>Last seen</th><th>Last sync</th><th>Manifest</th><th>Cache / proof</th><th>Version</th><th>Action</th></tr></thead>
        <tbody>{nodes.map((node) => <tr key={node.id}><th scope="row">{node.organisation.name}<small>{node.facility.name}</small></th>
          <td>{node.name}</td><td>{node.effectiveStatus}</td><td>{when(node.lastSeenAt)}</td>
          <td>{when(node.lastSuccessfulSyncAt)}</td><td>{node.manifests[0] ? `#${node.manifests[0].sequence} · until ${when(node.manifests[0].validUntil)}` : "None"}</td>
          <td>{node.cachedContentCount} cached · {node.pendingProofCount} pending</td><td>{node.softwareVersion || "Not reported"}</td>
          <td>{node.status === "ACTIVE" ? <><button type="button" disabled={busy} onClick={() => act(node, "ROTATE_CREDENTIAL")}>Rotate</button>{" "}
            <button type="button" disabled={busy} onClick={() => act(node, "REVOKE")}>Revoke</button>{" "}
            <button type="button" disabled={busy} onClick={() => act(node, "DECOMMISSION")}>Decommission</button></> : "—"}</td></tr>)}</tbody></table></div>}
      <p className={styles.note}>Revocation stops cloud access immediately. A disconnected Edge can retain previously signed authority only until its bounded manifest expires; secure local wipe requires on-site verification.</p></section>
  </main>;
}
