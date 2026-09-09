"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const EMPTY_LOCATION = { name: "", timezone: "Europe/Malta", firstZoneName: "", brandId: "", addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", countryCode: "" };

function destination(returnTo) {
  if (returnTo === "players") return { href: "/dashboard/players", label: "Return to Players & Devices" };
  if (returnTo === "signage") return { href: "/dashboard/digital-signage", label: "Return to Digital Signage" };
  return null;
}

export default function LocationsClient({ initialLocations, brands, allowance, canManage, returnTo }) {
  const router = useRouter();
  const [locations, setLocations] = useState(initialLocations);
  const [form, setForm] = useState(EMPTY_LOCATION);
  const [zoneNames, setZoneNames] = useState({});
  const [renameValues, setRenameValues] = useState({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const back = destination(returnTo);
  const full = allowance.limit > 0 && locations.length >= allowance.limit;
  const zoneCount = useMemo(() => locations.reduce((sum, location) => sum + location.zones.length, 0), [locations]);

  async function send(url, options, fallback) {
    const response = await fetch(url, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || fallback);
    return result;
  }

  async function createLocation(event) {
    event.preventDefault(); setBusy("location"); setMessage("");
    try {
      const result = await send("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }, "Unable to create the location.");
      setLocations((current) => [...current, result.location].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(EMPTY_LOCATION);
      setMessage("Location and first area created. They are now available to players and displays.");
      router.refresh();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  }

  async function addZone(event, locationId) {
    event.preventDefault(); setBusy(`zone-${locationId}`); setMessage("");
    try {
      const result = await send(`/api/locations/${locationId}/zones`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: zoneNames[locationId] || "" }) }, "Unable to add the area.");
      setLocations((current) => current.map((location) => location.id === locationId ? { ...location, zones: [...location.zones, result.zone].sort((a, b) => a.name.localeCompare(b.name)) } : location));
      setZoneNames((current) => ({ ...current, [locationId]: "" }));
      setMessage("Area / zone added.");
      router.refresh();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  }

  async function rename(kind, locationId, zoneId = null) {
    const key = zoneId || locationId;
    const name = renameValues[key];
    if (!name?.trim()) return;
    setBusy(`rename-${key}`); setMessage("");
    try {
      const url = zoneId ? `/api/locations/${locationId}/zones/${zoneId}` : `/api/locations/${locationId}`;
      const result = await send(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, "Unable to rename this item.");
      setLocations((current) => current.map((location) => location.id !== locationId ? location : zoneId ? { ...location, zones: location.zones.map((zone) => zone.id === zoneId ? { ...zone, name: result.zone.name } : zone) } : { ...location, name: result.location.name }));
      setRenameValues((current) => ({ ...current, [key]: "" }));
      setMessage(`${kind} renamed without changing its player or display links.`);
      router.refresh();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(""); }
  }

  if (allowance.reason === "ONLINE_ONLY") return <main style={styles.page}><section style={styles.content}>
    <a href="/dashboard" style={styles.back}>← Dashboard</a><p style={styles.eyebrow}>PHYSICAL SERVICE SETUP</p><h1 style={styles.heading}>Locations & Zones</h1>
    <section style={styles.notice}><strong>No action needed for Online Radio.</strong><span>Locations and playback areas are only required when this organisation adds a Retail Radio or School Radio service.</span></section>
  </section></main>;

  return <main style={styles.page}><section style={styles.content}>
    <a href="/dashboard" style={styles.back}>← Dashboard</a>
    <p style={styles.eyebrow}>PHYSICAL SERVICE SETUP</p><h1 style={styles.heading}>Locations & Zones</h1>
    <p style={styles.lead}>Create each physical site, then add the playback or display areas inside it. Players and screens use these exact areas, so you only set them up once.</p>
    <section style={styles.summary}><div><span>Locations</span><strong>{locations.length} / {allowance.limit}</strong></div><div><span>Areas / zones</span><strong>{zoneCount}</strong></div><div><span>Access</span><strong>{canManage ? "Owner / manager" : "View only"}</strong></div></section>
    {message ? <p role="status" style={message.includes("Unable") || message.includes("not ") ? styles.error : styles.success}>{message}</p> : null}
    {canManage ? <section style={styles.card}><h2>Create your first or next location</h2><p style={styles.copy}>A first area is required so the location can immediately be selected in Players & Devices and Digital Signage.</p>
      <form onSubmit={createLocation} style={styles.form}>
        <label style={styles.field}>Location name<input required minLength={2} maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Valletta shop" style={styles.input} /></label>
        <label style={styles.field}>First area / zone<input required minLength={2} maxLength={160} value={form.firstZoneName} onChange={(event) => setForm({ ...form, firstZoneName: event.target.value })} placeholder="Main floor" style={styles.input} /></label>
        <label style={styles.field}>Timezone<input required maxLength={100} value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} placeholder="Europe/Malta" style={styles.input} /></label>
        {brands.length ? <label style={styles.field}>Brand (optional)<select value={form.brandId} onChange={(event) => setForm({ ...form, brandId: event.target.value })} style={styles.input}><option value="">No specific brand</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label> : null}
        <label style={styles.field}>Address (optional)<input maxLength={200} value={form.addressLine1} onChange={(event) => setForm({ ...form, addressLine1: event.target.value })} style={styles.input} /></label>
        <label style={styles.field}>City (optional)<input maxLength={120} value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} style={styles.input} /></label>
        <label style={styles.field}>Country code (optional)<input maxLength={2} value={form.countryCode} onChange={(event) => setForm({ ...form, countryCode: event.target.value.toUpperCase() })} placeholder="MT" style={styles.input} /></label>
        <button disabled={busy || full} style={styles.primary}>{busy === "location" ? "Creating…" : "Create location and area"}</button>
      </form>{full ? <p style={styles.warning}>Your location allowance is full. Contact support before adding another location.</p> : null}
    </section> : <section style={styles.notice}><strong>View-only access</strong><span>An organisation owner or manager can create and rename locations and areas.</span></section>}

    <section style={styles.list}><h2>Your locations</h2>{!locations.length ? <p style={styles.copy}>No locations have been created yet.</p> : locations.map((location) => <article key={location.id} style={styles.location}>
      <header style={styles.locationHeader}><div><h3 style={styles.locationTitle}>{location.name}</h3><p style={styles.meta}>{location.timezone}{location.city ? ` · ${location.city}` : ""}{location.countryCode ? ` · ${location.countryCode}` : ""}</p></div><span style={styles.badge}>{location.status}</span></header>
      {canManage ? <div style={styles.rename}><input aria-label={`New name for ${location.name}`} value={renameValues[location.id] || ""} onChange={(event) => setRenameValues({ ...renameValues, [location.id]: event.target.value })} placeholder="Rename location" style={styles.input} /><button type="button" disabled={busy || !renameValues[location.id]?.trim()} onClick={() => rename("Location", location.id)} style={styles.secondary}>Save name</button></div> : null}
      <div style={styles.zones}>{location.zones.map((zone) => <div key={zone.id} style={styles.zone}><div><strong>{zone.name}</strong><span style={styles.meta}>Area / zone · {zone.status}</span></div>{canManage ? <div style={styles.rename}><input aria-label={`New name for ${zone.name}`} value={renameValues[zone.id] || ""} onChange={(event) => setRenameValues({ ...renameValues, [zone.id]: event.target.value })} placeholder="Rename area" style={styles.input} /><button type="button" disabled={busy || !renameValues[zone.id]?.trim()} onClick={() => rename("Area / zone", location.id, zone.id)} style={styles.secondary}>Save</button></div> : null}</div>)}</div>
      {canManage ? <form onSubmit={(event) => addZone(event, location.id)} style={styles.addZone}><label style={styles.field}>Add another area / zone<input required minLength={2} maxLength={160} value={zoneNames[location.id] || ""} onChange={(event) => setZoneNames({ ...zoneNames, [location.id]: event.target.value })} placeholder="Outdoor terrace" style={styles.input} /></label><button disabled={busy || !(zoneNames[location.id] || "").trim()} style={styles.primary}>{busy === `zone-${location.id}` ? "Adding…" : "Add area"}</button></form> : null}
    </article>)}</section>
    {back && locations.some((location) => location.zones.length) ? <a href={back.href} style={styles.returnButton}>{back.label}</a> : null}
  </section></main>;
}

const styles = {
  page: { minHeight: "100vh", background: "var(--rv-page-bg)", color: "var(--rv-text)", fontFamily: "Arial, sans-serif" }, content: { width: "min(1020px, calc(100% - 36px))", margin: "0 auto", padding: "44px 0 72px" }, back: { color: "#f4b942", fontWeight: 800, textDecoration: "none" }, eyebrow: { margin: "32px 0 10px", color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.4 }, heading: { margin: 0, fontSize: "clamp(36px, 6vw, 56px)" }, lead: { color: "var(--rv-text-muted)", maxWidth: 760, fontSize: 17, lineHeight: 1.6 }, summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, margin: "26px 0", padding: 18, borderRadius: 14, background: "var(--rv-surface)", border: "1px solid var(--rv-border)" }, card: { padding: 22, borderRadius: 14, background: "var(--rv-surface)", border: "1px solid var(--rv-border)" }, copy: { color: "var(--rv-text-muted)", lineHeight: 1.5 }, form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "end" }, field: { display: "grid", gap: 7, color: "var(--rv-text)", fontSize: 14, fontWeight: 800 }, input: { minHeight: 43, border: "1px solid var(--rv-border)", borderRadius: 8, padding: "9px 10px", background: "var(--rv-input-bg)", color: "var(--rv-input-text)" }, primary: { minHeight: 43, border: 0, borderRadius: 8, padding: "10px 15px", background: "#f4b942", color: "#111827", fontWeight: 900 }, secondary: { minHeight: 40, border: "1px solid var(--rv-border)", borderRadius: 8, padding: "8px 12px", background: "var(--rv-surface-muted)", color: "var(--rv-text)", fontWeight: 800 }, warning: { color: "var(--rv-warning-text)", fontWeight: 800 }, notice: { display: "grid", gap: 7, marginTop: 24, padding: 20, borderRadius: 12, border: "1px solid #f4b942", background: "var(--rv-warning-bg)", color: "var(--rv-warning-text)" }, success: { padding: 13, borderRadius: 9, background: "var(--rv-success-bg)", color: "var(--rv-success-text)", fontWeight: 800 }, error: { padding: 13, borderRadius: 9, background: "var(--rv-error-bg)", color: "var(--rv-error-text)", fontWeight: 800 }, list: { display: "grid", gap: 15, marginTop: 30 }, location: { padding: 21, borderRadius: 14, background: "var(--rv-surface)", border: "1px solid var(--rv-border)" }, locationHeader: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }, locationTitle: { margin: 0, fontSize: 24 }, meta: { display: "block", color: "var(--rv-text-muted)", fontSize: 12, marginTop: 5 }, badge: { padding: "5px 8px", borderRadius: 999, background: "var(--rv-success-bg)", color: "var(--rv-success-text)", fontSize: 11, fontWeight: 900 }, rename: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }, zones: { display: "grid", gap: 9, marginTop: 18 }, zone: { display: "flex", justifyContent: "space-between", gap: 15, flexWrap: "wrap", padding: 13, borderRadius: 9, background: "var(--rv-surface)" }, addZone: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 17 }, returnButton: { display: "inline-flex", marginTop: 24, padding: "12px 16px", borderRadius: 9, background: "#f4b942", color: "#111827", fontWeight: 900, textDecoration: "none" }
};
