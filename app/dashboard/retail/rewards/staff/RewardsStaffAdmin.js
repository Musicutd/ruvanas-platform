"use client";

import { useEffect, useRef, useState } from "react";
import { checkoutRequest, checkoutTransport } from "@/lib/retail-rewards/checkout-ui.mjs";
import { isoToWallTime } from "@/lib/retail-rewards/offer-ui.mjs";
import { staffOverview, staffPresets, staffSaveInput, staffMutationResult, staffGrantState, staffMessage,
  STAFF_CAPABILITY_LABELS, STAFF_ROLE_LABELS } from "@/lib/retail-rewards/staff-admin-ui.mjs";
import styles from "./staff-admin.module.css";

const BASE = "/api/retail-rewards/staff";
const blank = () => ({ locationIds: [], capabilities: [], expiresAt: "", confirm: false });
const when = value => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Malta" }).format(new Date(value));
const toggle = (values, value) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];

export default function RewardsStaffAdmin({ initialData, transport = checkoutTransport, previewOnly = false }) {
  const initial = staffOverview(initialData);
  const [data, setData] = useState(initial), [selected, setSelected] = useState(""), [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(""), [error, setError] = useState(initial ? "" : staffMessage(initialData?.code));
  const [notice, setNotice] = useState(""), [revoke, setRevoke] = useState(false);
  const epoch = useRef(0), controller = useRef(null), alive = useRef(true), errorRef = useRef(null), formRef = useRef(null);
  const organisationId = useRef(initial?.organisation.id || null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; controller.current?.abort(); }; }, []);
  useEffect(() => {
    epoch.current++; controller.current?.abort(); controller.current = null;
    const value = staffOverview(initialData); organisationId.current = value?.organisation.id || null;
    setData(value); setSelected(""); setForm(blank()); setRevoke(false); setBusy(""); setNotice(""); setError(value ? "" : staffMessage(initialData?.code));
  }, [initialData]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const member = data?.members.find(row => row.id === selected);
  function start(operation) {
    epoch.current++; controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(operation); setError(""); setNotice(""); setRevoke(false);
    return { epoch: epoch.current, abort, timer: setTimeout(() => abort.abort(), 20000), organisationId: organisationId.current };
  }
  const current = request => alive.current && epoch.current === request.epoch && organisationId.current === request.organisationId;
  function finish(request) { clearTimeout(request.timer); if (current(request)) { setBusy(""); controller.current = null; } }
  async function read(request) {
    const result = await checkoutRequest(transport, `${BASE}/overview`, { signal: request.abort.signal });
    const parsed = staffOverview(result, request.organisationId);
    if (!parsed) { const problem = new Error(); problem.code = result?.organisation?.id && result.organisation.id !== request.organisationId ? "ORGANISATION_CHANGED" : undefined; throw problem; }
    return parsed;
  }
  async function refresh() {
    if (busy) return;
    const request = start("refresh"); setData(null); setSelected(""); setForm(blank());
    try { const value = await read(request); if (current(request)) { organisationId.current = value.organisation.id; setData(value); } }
    catch (problem) { if (current(request)) setError(staffMessage(problem.code)); } finally { finish(request); }
  }
  function choose(memberId) {
    if (busy) return;
    epoch.current++; controller.current?.abort(); setSelected(memberId); setForm(blank()); setRevoke(false); setNotice(""); setError("");
  }
  async function mutate(operation, payload) {
    if (busy || !member || !data || data.organisation.id !== organisationId.current) return;
    const request = start(operation), memberId = member.id; setData(null);
    try {
      const result = await checkoutRequest(transport, `${BASE}/${operation}`, { method: "POST", body: payload, signal: request.abort.signal });
      if (!current(request)) return;
      if (!staffMutationResult(result, memberId)) throw new Error();
      const value = await read(request); if (!current(request)) return;
      setData(value); setSelected(value.members.some(row => row.id === memberId) ? memberId : ""); setForm(blank());
      setNotice(operation === "save" ? "Rewards access saved. The current access below reflects your selected shops and permissions." : "This member’s explicit Rewards access has been revoked.");
    } catch (problem) { if (current(request)) { setSelected(""); setForm(blank()); setError(staffMessage(problem.code)); } } finally { finish(request); }
  }
  function save(event) {
    event.preventDefault(); setError("");
    try { const payload = staffSaveInput(data, selected, form); void mutate("save", payload); }
    catch (problem) { setError(problem.message || staffMessage("INVALID_REQUEST")); }
  }
  function update(key, value) { setForm(previous => ({ ...previous, [key]: value, confirm: false })); setRevoke(false); }
  const grants = member?.grants || [], outstanding = grants.some(row => row.revokedAt === null);
  const names = data?.locations.filter(row => form.locationIds.includes(row.id)).map(row => row.name) || [];
  return <main className={styles.page}>
    {previewOnly && <p className={styles.preview}><strong>LOCAL PREVIEW</strong> · Synthetic team and shops · Nothing is sent or published</p>}
    <div className={styles.container}>
      <a href="/dashboard/retail/rewards" className={styles.back}>← Shop Rewards</a>
      <div className={styles.heading}><div><p className={styles.eyebrow}>REWARDS · YOUR TEAM</p><h1>The right access. For each shop.</h1><p className={styles.lead}>Choose what existing team members can do, where they can do it and when access ends.</p></div><button className={styles.secondary} onClick={refresh} disabled={!!busy}>{busy === "refresh" ? "Refreshing…" : "Refresh staff access"}</button></div>
      <p className={styles.notice}>Only your organisation’s owner can change these permissions. Team members keep their existing accounts and roles. No invitation email or subscription purchase is made here.</p>
      {busy && <p role="status" className={styles.status}>Checking current access and saved permissions…</p>}
      {error && <p role="alert" ref={errorRef} tabIndex={-1} className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.success}>{notice}</p>}
      {data && <>
        <div className={styles.summary} aria-label="Current Rewards allowance"><div><span>Organisation</span><strong>{data.organisation.name}</strong></div><div><span>Rewards staff seats</span><strong>{data.seatUsage.used} / {data.seatUsage.limit}</strong><small>Existing unexpired staff grants reserve a seat until revoked, even if a member role changes.</small></div><div><span>Rewards access ends</span><strong>{when(data.grantExpiresAt)}</strong><small>All times are Europe/Malta.</small></div></div>
        <div className={styles.layout}>
          <section className={styles.team} aria-label="Existing team members"><h2>1. Choose a team member</h2><p className={styles.help}>Only eligible existing members of this organisation appear here.</p>
            {!data.members.length && <p className={styles.empty}>There are no eligible team members yet. Add team members through your organisation’s existing account management, then refresh.</p>}
            <div className={styles.memberList} role="group" aria-label="Choose a team member">{data.members.map(row => <button key={row.id} className={selected === row.id ? styles.memberSelected : styles.member} aria-pressed={selected === row.id} onClick={() => choose(row.id)}><strong>{row.displayName}</strong><span>{STAFF_ROLE_LABELS[row.role]}</span><small>{row.usesSeat ? "Reserves a Rewards staff seat" : "No Rewards staff seat reserved"}</small></button>)}</div>
          </section>
          {!member ? <section className={styles.prompt}><span className={styles.step}>2</span><h2>Choose a person to begin</h2><p>You’ll review their current access before choosing shops and permissions.</p></section> : <section ref={formRef} className={styles.card} aria-label={`Rewards access for ${member.displayName}`}>
            <div className={styles.heading}><div><p className={styles.eyebrow}>{STAFF_ROLE_LABELS[member.role]}</p><h2>{member.displayName}</h2></div><span className={styles.badge}>{member.usesSeat ? "Seat reserved" : "No reserved seat"}</span></div>
            <details className={styles.currentAccess} open><summary>Current saved access ({grants.length})</summary>
              {!grants.length && <p>No explicit Rewards access has been saved for this member.</p>}
              {grants.map(grant => <article key={grant.id} className={styles.grant}><div><strong>{grant.scope === "ALL_LOCATIONS" ? "All shops — existing access" : data.locations.find(row => row.id === grant.locationId)?.name || "Shop no longer active"}</strong><span className={styles.badge}>{staffGrantState(grant)}</span></div><p>{grant.capabilities.map(capability => STAFF_CAPABILITY_LABELS[capability]).join(" · ")}</p><small>{when(grant.startsAt)} – {when(grant.expiresAt)} Malta time</small></article>)}
              {outstanding && <button className={styles.danger} onClick={() => { setRevoke(true); setForm(previous => ({ ...previous, confirm: false })); }}>Revoke this member’s Rewards access</button>}
            </details>
            {revoke && <section className={styles.revoke} aria-label="Confirm staff access revocation"><h3>Revoke {member.displayName}’s Rewards permissions?</h3><p>This removes their explicit Rewards permissions at every shop in this organisation. It does not delete their account, shop records or redemption history.</p><div className={styles.actions}><button className={styles.danger} onClick={() => mutate("revoke", { memberId: member.id, expectedVersion: member.version, confirm: true })}>Confirm revocation</button><button className={styles.secondary} onClick={() => setRevoke(false)}>Cancel</button></div></section>}
            <form onSubmit={save}>
              <h3>2. Choose the shops</h3><p className={styles.help}>Select the exact shops this access covers. New shops are not added automatically.</p>
              {!data.locations.length && <p className={styles.empty}>No active shops are available. You can still review or revoke saved access.</p>}
              <fieldset className={styles.choices}><legend className={styles.srOnly}>Shops for this member</legend>{data.locations.map(location => <label key={location.id}><input type="checkbox" checked={form.locationIds.includes(location.id)} onChange={() => update("locationIds", toggle(form.locationIds, location.id))} disabled={!form.locationIds.includes(location.id) && form.locationIds.length >= 20} /><span>{location.name}</span></label>)}</fieldset>
              <p className={styles.help}>{form.locationIds.length} selected · Maximum 20 per saved setup, within your current shop allowance.</p>
              <h3>3. Choose the permissions</h3><p className={styles.help}>Use a preset or choose individual permissions. Their existing role sets the maximum.</p>
              <div className={styles.presets}>{staffPresets(member).map(preset => <button key={preset.id} type="button" className={styles.preset} onClick={() => update("capabilities", [...preset.capabilities])}><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</div>
              <fieldset className={styles.choices}><legend className={styles.srOnly}>Rewards permissions</legend>{member.allowedCapabilities.map(capability => <label key={capability}><input type="checkbox" checked={form.capabilities.includes(capability)} onChange={() => update("capabilities", toggle(form.capabilities, capability))} /><span>{STAFF_CAPABILITY_LABELS[capability]}</span></label>)}</fieldset>
              {form.capabilities.includes("REDEEM") && !form.capabilities.includes("READ") && <p className={styles.tip}>Cashier access can redeem coupons without access to the coupon management list.</p>}
              <h3>4. Set an expiry</h3><label className={styles.field}>Access ends (Malta time)<input type="datetime-local" required value={form.expiresAt} max={isoToWallTime(data.grantExpiresAt, "Europe/Malta")} onChange={event => update("expiresAt", event.target.value)} /></label><button type="button" className={styles.textButton} onClick={() => update("expiresAt", isoToWallTime(data.grantExpiresAt, "Europe/Malta"))}>Use the current Rewards expiry</button>
              <div className={styles.review}><h3>Review this access</h3><p><strong>Shops:</strong> {names.length ? names.join(", ") : "Choose at least one shop."}</p><p><strong>Permissions:</strong> {form.capabilities.length ? form.capabilities.map(capability => STAFF_CAPABILITY_LABELS[capability]).join(", ") : "Choose at least one permission."}</p><p><strong>Access ends:</strong> {form.expiresAt ? `${form.expiresAt.replace("T", " ")} Malta time` : "Choose an expiry."}</p><p>This replaces all this member’s existing explicit Rewards permissions, including any previous all-shops access. Only the selected shops and permissions remain.</p><label className={styles.confirm}><input type="checkbox" checked={form.confirm} onChange={event => setForm(previous => ({ ...previous, confirm: event.target.checked }))} /><span>I confirm these exact shops, permissions and expiry for {member.displayName}.</span></label><button className={styles.primary} disabled={!form.confirm || !form.locationIds.length || !form.capabilities.length || !form.expiresAt || !!busy}>Save Rewards access</button></div>
            </form>
          </section>}
        </div><p className={styles.checked}>Saved state checked {when(data.checkedAt)} Malta time. Changes made in another session require a fresh review.</p>
      </>}
    </div>
  </main>;
}

