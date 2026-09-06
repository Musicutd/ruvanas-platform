"use client";

import { useState } from "react";

const emptyLink = () => ({ label: "", url: "" });

export default function StationWebsiteSettings({ station, canManage }) {
  const [settings, setSettings] = useState({
    enabled: station.stationWebsiteEnabled,
    headline: station.stationWebsiteHeadline || "",
    about: station.stationWebsiteAbout || "",
    heroImageUrl: station.stationWebsiteHeroImageUrl || "",
    contactEmail: station.stationWebsiteContactEmail || "",
    theme: station.stationWebsiteTheme,
    links: [...(Array.isArray(station.stationWebsiteLinks) ? station.stationWebsiteLinks : []), emptyLink()].slice(0, 6),
    showNowPlaying: station.stationWebsiteShowNowPlaying,
    showPodcasts: station.stationWebsiteShowPodcasts
  });
  const [domains, setDomains] = useState(station.websiteDomains);
  const [hostname, setHostname] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function field(name, value) { setSettings((current) => ({ ...current, [name]: value })); }
  function linkField(index, name, value) {
    setSettings((current) => ({ ...current, links: current.links.map((link, position) => position === index ? { ...link, [name]: value } : link) }));
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/stations/${station.id}/website`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, links: settings.links.filter((link) => link.label.trim() || link.url.trim()) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save the station website.");
      setMessage(settings.enabled ? "Station website published." : "Station website saved privately.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function addDomain(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/stations/${station.id}/website/domains`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to add this domain.");
      setDomains((current) => [...current, body.domain]); setHostname("");
      setMessage("Domain added. Create the displayed TXT record, then verify it.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function domainAction(id, action) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/stations/${station.id}/website/domains/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update this domain.");
      setDomains((current) => current.map((domain) => domain.id === id ? body.domain : domain));
      setMessage(action === "VERIFY" ? (body.verified ? "Domain ownership verified." : "The verification record was not found yet.") : action === "ACTIVATE" ? "Custom domain activated for this station." : "Custom domain disabled.");
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <div style={styles.grid}>
    <section style={styles.card}>
      <div style={styles.statusRow}><div><p style={styles.kicker}>PUBLIC WEBSITE</p><h2 style={styles.heading}>Design and publish</h2></div><span style={{ ...styles.badge, ...(settings.enabled ? styles.live : {}) }}>{settings.enabled ? "LIVE" : "PRIVATE"}</span></div>
      <label style={styles.toggle}><input type="checkbox" checked={settings.enabled} disabled={!canManage} onChange={(event) => field("enabled", event.target.checked)} /> Publish the full station website</label>
      <div style={styles.twoColumns}>
        <label style={styles.label}>Website theme<select style={styles.input} value={settings.theme} disabled={!canManage} onChange={(event) => field("theme", event.target.value)}><option value="MIDNIGHT">Midnight</option><option value="LIGHT">Editorial light</option><option value="VIBRANT">Vibrant broadcast</option></select></label>
        <label style={styles.label}>Public contact email<input style={styles.input} type="email" value={settings.contactEmail} maxLength={254} disabled={!canManage} onChange={(event) => field("contactEmail", event.target.value)} placeholder="studio@example.com" /></label>
      </div>
      <label style={styles.label}>Main headline<input style={styles.input} value={settings.headline} maxLength={160} disabled={!canManage} onChange={(event) => field("headline", event.target.value)} placeholder={`Live radio from ${station.name}`} /></label>
      <label style={styles.label}>About the station<textarea style={{ ...styles.input, minHeight: 150 }} value={settings.about} maxLength={3000} disabled={!canManage} onChange={(event) => field("about", event.target.value)} placeholder="Tell listeners what makes your station worth hearing." /></label>
      <label style={styles.label}>Hero image HTTPS address<input style={styles.input} type="url" value={settings.heroImageUrl} maxLength={2048} disabled={!canManage} onChange={(event) => field("heroImageUrl", event.target.value)} placeholder="https://example.com/station-hero.jpg" /></label>
      <div style={styles.options}><label style={styles.toggle}><input type="checkbox" checked={settings.showNowPlaying} disabled={!canManage} onChange={(event) => field("showNowPlaying", event.target.checked)} /> Show live now-playing</label><label style={styles.toggle}><input type="checkbox" checked={settings.showPodcasts} disabled={!canManage} onChange={(event) => field("showPodcasts", event.target.checked)} /> Show published podcasts</label></div>
      <div style={styles.linksBox}><strong>Station links</strong><p style={styles.muted}>Add up to six public HTTPS links, such as Instagram, Facebook or a programme guide.</p>{settings.links.map((link, index) => <div style={styles.linkRow} key={index}><input aria-label={`Link ${index + 1} label`} style={styles.input} value={link.label} maxLength={40} disabled={!canManage} onChange={(event) => linkField(index, "label", event.target.value)} placeholder="Instagram" /><input aria-label={`Link ${index + 1} address`} style={styles.input} value={link.url} maxLength={2048} disabled={!canManage} onChange={(event) => linkField(index, "url", event.target.value)} placeholder="https://…" /></div>)}{settings.links.length < 6 && canManage ? <button style={styles.textButton} type="button" onClick={() => setSettings((current) => ({ ...current, links: [...current.links, emptyLink()] }))}>+ Add another link</button> : null}</div>
      {canManage ? <button style={styles.primary} type="button" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save station website"}</button> : <p style={styles.notice}>An organisation owner or manager can change these settings.</p>}
      {message ? <p style={styles.notice} role="status">{message}</p> : null}
    </section>

    <aside style={styles.side}>
      <section style={styles.card}><p style={styles.kicker}>PREVIEW & MOBILE</p><h2 style={styles.heading}>Your public address</h2><p style={styles.muted}>The website remains separate from private subscriber controls and streaming credentials. Supported phones and computers can install it directly from the browser.</p><a style={styles.preview} href={`/radio/${station.slug}`} target="_blank" rel="noreferrer">Open station website ↗</a><a style={styles.secondaryLink} href={`/listen/${station.slug}`} target="_blank" rel="noreferrer">Open live player</a></section>
      <section style={styles.card}><p style={styles.kicker}>CUSTOM DOMAIN</p><h2 style={styles.heading}>Use your own address</h2><p style={styles.muted}>Add a hostname you own. Ruvanas activates it only after the DNS ownership record is verified.</p>
        {canManage ? <form onSubmit={addDomain} style={styles.domainForm}><input style={styles.input} value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="radio.example.com" required /><button style={styles.secondaryButton} disabled={busy}>Add domain</button></form> : null}
        <div style={styles.domainList}>{domains.map((domain) => <article style={styles.domain} key={domain.id}><div style={styles.statusRow}><strong>{domain.hostname}</strong><span style={styles.smallBadge}>{domain.status}</span></div><dl style={styles.dns}><dt>TXT name</dt><dd>{domain.dnsName}</dd><dt>TXT value</dt><dd>{domain.dnsValue}</dd></dl>{canManage ? <div style={styles.domainActions}>{domain.status !== "ACTIVE" ? <button disabled={busy} onClick={() => domainAction(domain.id, "VERIFY")}>Verify DNS</button> : null}{domain.status === "VERIFIED" ? <button disabled={busy} onClick={() => domainAction(domain.id, "ACTIVATE")}>Activate</button> : null}{domain.status === "ACTIVE" ? <button disabled={busy} onClick={() => domainAction(domain.id, "DISABLE")}>Disable</button> : null}</div> : null}</article>)}</div>
      </section>
    </aside>
  </div>;
}

const styles = {
  grid: { display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, .75fr)", gap: 18, marginTop: 34, alignItems: "start" },
  side: { display: "grid", gap: 18 }, card: { background: "#131e31", border: "1px solid #2a3a54", borderRadius: 18, padding: 26 },
  statusRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }, kicker: { color: "#f4b942", fontSize: 11, fontWeight: 900, letterSpacing: 1.5, margin: "0 0 7px" },
  heading: { margin: 0, fontSize: 27 }, badge: { borderRadius: 999, padding: "7px 11px", background: "#273449", color: "#cbd5e1", fontSize: 10, fontWeight: 900, letterSpacing: 1 }, live: { background: "#153a2d", color: "#7bf0ba" },
  label: { display: "grid", gap: 8, marginTop: 18, color: "#dbe5f3", fontWeight: 750, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #3a4b67", borderRadius: 10, background: "#0d1728", color: "#f8fafc", padding: "12px 13px", font: "inherit" },
  toggle: { display: "flex", gap: 10, alignItems: "center", margin: "18px 0", color: "#e7edf7", fontWeight: 750 }, twoColumns: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }, options: { display: "flex", gap: 24, flexWrap: "wrap" },
  linksBox: { marginTop: 20, padding: 18, borderRadius: 14, background: "#0d1728", border: "1px solid #2e405b" }, linkRow: { display: "grid", gridTemplateColumns: ".4fr 1fr", gap: 8, marginTop: 10 }, textButton: { border: 0, background: "transparent", color: "#f4b942", padding: "14px 0 0", fontWeight: 850, cursor: "pointer" },
  muted: { color: "#9fb0c7", lineHeight: 1.55 }, notice: { color: "#f4c766", lineHeight: 1.5 }, primary: { marginTop: 22, border: 0, borderRadius: 9, padding: "13px 18px", background: "#f4b942", color: "#111827", fontWeight: 900, cursor: "pointer" },
  preview: { display: "block", marginTop: 20, borderRadius: 10, padding: "13px 16px", background: "#f4b942", color: "#111827", fontWeight: 900, textDecoration: "none", textAlign: "center" }, secondaryLink: { display: "block", marginTop: 10, color: "#dbe5f3", textAlign: "center", textDecoration: "none", fontWeight: 800 },
  domainForm: { display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 18 }, secondaryButton: { border: "1px solid #52627a", borderRadius: 9, padding: "11px 14px", background: "transparent", color: "#fff", fontWeight: 850 }, domainList: { display: "grid", gap: 12, marginTop: 18 }, domain: { padding: 15, borderRadius: 12, border: "1px solid #334762", background: "#0d1728" }, smallBadge: { borderRadius: 999, padding: "5px 8px", background: "#273449", color: "#cbd5e1", fontSize: 9, fontWeight: 900 }, dns: { display: "grid", gridTemplateColumns: "70px 1fr", gap: "6px 10px", margin: "14px 0", fontSize: 11 }, domainActions: { display: "flex", gap: 8 },
};
