"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./programming.module.css";

function dateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function initialForm() {
  const start = new Date(Date.now() + 5 * 60_000);
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  return { label: "", channelId: "", granteeUserId: "", startsAt: dateTimeValue(start), endsAt: dateTimeValue(end), capabilities: ["VIEW_CHANNEL", "CONTROL_EXTERNAL_LIVE"] };
}

const CAPABILITIES = [
  ["CONTROL_EXTERNAL_LIVE", "Control External Live"],
  ["START_BROWSER_STUDIO", "Browser Live Studio (when available)"],
  ["RECORD_LIVE_SESSION", "Record live session"]
];

export default function DjAccessWorkspace() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [privateLink, setPrivateLink] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/programming/dj-access", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load DJ access.");
      setData(payload);
    } catch (loadError) { setError(loadError.message); } finally { setBusy(""); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function setCapability(capability, checked) {
    const values = checked ? [...new Set([...form.capabilities, capability])] : form.capabilities.filter((value) => value !== capability);
    if (!checked && capability === "START_BROWSER_STUDIO") setForm({ ...form, capabilities: values.filter((value) => value !== "RECORD_LIVE_SESSION") });
    else if (checked && capability === "RECORD_LIVE_SESSION") setForm({ ...form, capabilities: [...new Set([...values, "START_BROWSER_STUDIO"])] });
    else setForm({ ...form, capabilities: values });
  }

  function revealLink(path, message) {
    setPrivateLink(`${window.location.origin}${path}`);
    setNotice(message);
  }

  async function create(event) {
    event.preventDefault(); setBusy("create"); setError(""); setNotice(""); setPrivateLink("");
    try {
      const response = await fetch("/api/programming/dj-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to issue DJ access.");
      revealLink(payload.accessPath, payload.tokenNotice); setForm(initialForm()); await load();
    } catch (saveError) { setError(saveError.message); } finally { setBusy(""); }
  }

  async function act(grant, action) {
    setBusy(`${action}:${grant.id}`); setError(""); setNotice(""); setPrivateLink("");
    try {
      const response = await fetch(`/api/programming/dj-access/${grant.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason: action === "REVOKE" ? "Access ended by an organisation manager." : undefined }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update DJ access.");
      if (payload.accessPath) revealLink(payload.accessPath, payload.tokenNotice);
      else setNotice(`${grant.label} has been revoked. Its private link and active browser access no longer work.`);
      await load();
    } catch (actionError) { setError(actionError.message); } finally { setBusy(""); }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(privateLink);
    setNotice("Private DJ access link copied. Send it only to the named presenter.");
  }

  if (busy === "load" && !data) return <section className={styles.panel}><div className={styles.loading}>Loading DJ access…</div></section>;
  const grants = data?.grants || [];
  return <section className={styles.panel} aria-labelledby="dj-access-title">
    <div className={styles.sectionHeading}><div><p className={styles.kicker}>DJ ACCESS</p><h2 id="dj-access-title">Give presenters only the access they need</h2></div><span className={styles.count}>{grants.filter((grant) => ["ACTIVE", "SCHEDULED"].includes(grant.state)).length} open</span></div>
    <p className={styles.panelIntro}>Issue a private, channel-scoped link to an existing Ruvanas team member for one show window. The presenter must sign in with the named account, and you can replace or revoke the link immediately.</p>
    <div className={styles.safetyBanner}><strong>Least privilege</strong><span>Every grant has a start, an end and explicit permissions. Links are stored only as secure hashes, never shown again, and every grant, rotation and revocation is audited.</span></div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}{notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {privateLink ? <div className={styles.privateLink}><div><strong>Copy this private link now</strong><span>It will not be displayed again.</span></div><code>{privateLink}</code><button type="button" className={styles.primaryButton} onClick={copyLink}>Copy link</button></div> : null}
    {grants.length ? <div className={styles.djGrantGrid}>{grants.map((grant) => <article className={grant.state === "ACTIVE" ? styles.externalLiveActive : styles.externalLiveCard} key={grant.id}>
      <div className={styles.smartPlaylistTitle}><div><strong>{grant.label}</strong><span>{grant.grantee?.name} · {grant.channel?.name}</span></div><span className={grant.state === "ACTIVE" ? styles.liveSourceBadge : grant.state === "REVOKED" || grant.state === "EXPIRED" ? styles.healthWarning : styles.draftBadge}>{grant.state}</span></div>
      <p>{new Date(grant.startsAt).toLocaleString()} → {new Date(grant.endsAt).toLocaleString()}</p>
      <div className={styles.liveSourceMeta}>{grant.capabilities.map((capability) => <span key={capability}>{capability.replaceAll("_", " ").toLowerCase()}</span>)}</div>
      <small>{grant.token?.lastUsedAt ? `Last used ${new Date(grant.token.lastUsedAt).toLocaleString()}` : "Private link has not been used."}</small>
      {grant.status === "ACTIVE" && new Date(grant.endsAt) > new Date() ? <div className={styles.cardActions}><button type="button" className={styles.secondaryButton} disabled={busy !== ""} onClick={() => act(grant, "ROTATE")}>Replace link</button><button type="button" className={styles.removeButton} disabled={busy !== ""} onClick={() => act(grant, "REVOKE")}>Revoke now</button></div> : null}
    </article>)}</div> : <div className={styles.emptyState}>No DJ access has been issued. Create a bounded grant below when a presenter needs to connect.</div>}
    <form className={styles.schedulerForm} onSubmit={create}>
      <div className={styles.smartFormHeader}><div><h3>Issue DJ access</h3><p>The private link works only for the selected member, channel and time window.</p></div></div>
      <div className={styles.formGrid}>
        <label><span>Access label</span><input required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="e.g. Friday drive-time host" /></label>
        <label><span>Presenter</span><select required value={form.granteeUserId} onChange={(event) => setForm({ ...form, granteeUserId: event.target.value })}><option value="">Choose team member</option>{(data?.members || []).map((member) => <option value={member.id} key={member.id}>{member.name} · {member.role.toLowerCase()}</option>)}</select></label>
        <label><span>Channel</span><select required value={form.channelId} onChange={(event) => setForm({ ...form, channelId: event.target.value })}><option value="">Choose channel</option>{(data?.channels || []).map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}</select></label>
        <label><span>Access starts</span><input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
        <label><span>Access ends</span><input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label>
      </div>
      <div className={styles.capabilityGrid}>{CAPABILITIES.map(([value, label]) => <label key={value}><input type="checkbox" checked={form.capabilities.includes(value)} onChange={(event) => setCapability(value, event.target.checked)} /><span>{label}</span></label>)}</div>
      <div className={styles.actionBar}><span className={styles.safeClaim}>Existing identity · one channel · maximum 12 hours</span><button className={styles.primaryButton} disabled={busy !== ""}>{busy === "create" ? "Issuing…" : "Issue private DJ link"}</button></div>
    </form>
  </section>;
}

