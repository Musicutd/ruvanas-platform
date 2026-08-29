"use client";

import { useEffect, useMemo, useState } from "react";

const emptyData = { assets: [], layouts: [], devices: [] };

export default function DigitalSignageConsole({ organisations, showOrganisationSelector = true }) {
  const enabledOrganisations = organisations.filter((item) => item.digitalSignageEnabled);
  const [organisationId, setOrganisationId] = useState(enabledOrganisations[0]?.id || "");
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const selected = useMemo(() => organisations.find((item) => item.id === organisationId), [organisationId, organisations]);
  const zones = selected?.locations.flatMap((location) => location.zones.map((zone) => ({ ...zone, locationName: location.name }))) || [];

  async function load() {
    if (!organisationId) { setData(emptyData); return; }
    setLoading(true); setMessage("");
    try {
      const query = `?organisationId=${encodeURIComponent(organisationId)}`;
      const [assetsResponse, layoutsResponse, devicesResponse] = await Promise.all([
        fetch(`/api/admin/digital-signage/assets${query}`),
        fetch(`/api/admin/digital-signage/layouts${query}`),
        fetch(`/api/admin/digital-signage/devices${query}`)
      ]);
      const [assets, layouts, devices] = await Promise.all([assetsResponse.json(), layoutsResponse.json(), devicesResponse.json()]);
      const failed = [[assetsResponse, assets], [layoutsResponse, layouts], [devicesResponse, devices]].find(([response]) => !response.ok);
      if (failed) throw new Error(failed[1].error || "Unable to load the signage workspace.");
      setData({ assets: assets.assets, layouts: layouts.layouts, devices: devices.devices });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load the signage workspace."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [organisationId]);

  async function uploadAsset(event) {
    event.preventDefault(); setBusy("asset"); setMessage("");
    try {
      const formData = new FormData(event.currentTarget);
      formData.set("organisationId", organisationId);
      const response = await fetch("/api/admin/digital-signage/assets", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to upload the image.");
      event.currentTarget.reset();
      await load();
      setMessage(result.duplicate ? "This image already exists in the visual library." : "Visual asset uploaded safely.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to upload the image."); }
    finally { setBusy(""); }
  }

  async function createLayout(event) {
    event.preventDefault(); setBusy("layout"); setMessage("");
    const formData = new FormData(event.currentTarget);
    const canvasWidth = Number(formData.get("canvasWidth"));
    const canvasHeight = Number(formData.get("canvasHeight"));
    try {
      const response = await fetch("/api/admin/digital-signage/layouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        organisationId,
        name: formData.get("name"),
        description: formData.get("description"),
        canvasWidth,
        canvasHeight,
        backgroundColor: formData.get("backgroundColor"),
        regions: [{ name: "Main visual", x: 0, y: 0, width: canvasWidth, height: canvasHeight, zIndex: 0, fitMode: "COVER" }]
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create the layout.");
      event.currentTarget.reset(); await load(); setMessage("Reusable full-screen layout created.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create the layout."); }
    finally { setBusy(""); }
  }

  async function createDevice(event) {
    event.preventDefault(); setBusy("device"); setMessage("");
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/digital-signage/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        organisationId,
        zoneId: formData.get("zoneId"),
        name: formData.get("name"),
        viewportWidth: Number(formData.get("viewportWidth")),
        viewportHeight: Number(formData.get("viewportHeight"))
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create the device.");
      event.currentTarget.reset();
      await load();
      setMessage(`Device created. One-time enrolment code: ${result.device.enrolmentCode}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create the device."); }
    finally { setBusy(""); }
  }

  return <main style={styles.page}>
    <p style={styles.eyebrow}>Stage 7B</p>
    <h1 style={styles.title}>Digital Signage foundation</h1>
    <p style={styles.copy}>Prepare approved visual assets, reusable screen layouts, and tenant-owned display devices. Scheduling and combined audio/visual proof remain gated for the next stage.</p>

    {showOrganisationSelector ? <label style={styles.label}>Organisation
      <select value={organisationId} onChange={(event) => setOrganisationId(event.target.value)} style={styles.input}>
        <option value="">Select an enabled organisation</option>
        {enabledOrganisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label> : null}

    {!organisationId ? <section style={styles.notice}>Digital Signage must be enabled for an organisation before visual content or devices can be prepared.</section> : <>
      {message ? <section style={styles.message}>{message}</section> : null}
      {loading ? <p style={styles.copy}>Refreshing workspace…</p> : null}
      <section style={styles.grid}>
        <form onSubmit={uploadAsset} style={styles.card}>
          <h2 style={styles.cardTitle}>Visual library</h2>
          <p style={styles.small}>PNG or JPEG, maximum 15 MB. File signatures and image dimensions are verified before storage.</p>
          <label style={styles.label}>Display name<input name="name" required maxLength={200} style={styles.input} /></label>
          <label style={styles.label}>Image<input name="file" type="file" required accept="image/png,image/jpeg" style={styles.input} /></label>
          <button disabled={busy === "asset"} style={styles.button}>{busy === "asset" ? "Uploading…" : "Upload visual"}</button>
          <p style={styles.count}>{data.assets.length} active visual asset{data.assets.length === 1 ? "" : "s"}</p>
          {data.assets.slice(0, 5).map((asset) => <div key={asset.id} style={styles.row}><strong>{asset.name}</strong><span>{asset.width}×{asset.height} · {(Number(asset.sizeBytes) / 1048576).toFixed(1)} MB</span></div>)}
        </form>

        <form onSubmit={createLayout} style={styles.card}>
          <h2 style={styles.cardTitle}>Reusable layouts</h2>
          <p style={styles.small}>Start with a safe full-screen template. Multi-region composition is supported by the foundation and will gain a visual editor later.</p>
          <label style={styles.label}>Layout name<input name="name" required maxLength={200} style={styles.input} /></label>
          <label style={styles.label}>Description<input name="description" maxLength={1000} style={styles.input} /></label>
          <div style={styles.two}><label style={styles.label}>Width<input name="canvasWidth" type="number" min="320" max="8192" defaultValue="1920" required style={styles.input} /></label><label style={styles.label}>Height<input name="canvasHeight" type="number" min="240" max="8192" defaultValue="1080" required style={styles.input} /></label></div>
          <label style={styles.label}>Background colour<input name="backgroundColor" type="color" defaultValue="#000000" style={styles.input} /></label>
          <button disabled={busy === "layout"} style={styles.button}>{busy === "layout" ? "Creating…" : "Create layout"}</button>
          <p style={styles.count}>{data.layouts.length} layout{data.layouts.length === 1 ? "" : "s"}</p>
          {data.layouts.slice(0, 5).map((layout) => <div key={layout.id} style={styles.row}><strong>{layout.name}</strong><span>{layout.canvasWidth}×{layout.canvasHeight} · {layout.status}</span></div>)}
        </form>

        <form onSubmit={createDevice} style={styles.card}>
          <h2 style={styles.cardTitle}>Display devices</h2>
          <p style={styles.small}>Bind each screen to one existing location zone. Enrolment codes expire after 24 hours and are shown only once.</p>
          <label style={styles.label}>Device name<input name="name" required maxLength={200} style={styles.input} /></label>
          <label style={styles.label}>Location and zone<select name="zoneId" required style={styles.input}><option value="">Select a zone</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.locationName} — {zone.name}</option>)}</select></label>
          <div style={styles.two}><label style={styles.label}>Screen width<input name="viewportWidth" type="number" min="320" max="8192" defaultValue="1920" required style={styles.input} /></label><label style={styles.label}>Screen height<input name="viewportHeight" type="number" min="240" max="8192" defaultValue="1080" required style={styles.input} /></label></div>
          <button disabled={busy === "device" || zones.length === 0} style={styles.button}>{busy === "device" ? "Creating…" : "Create device enrolment"}</button>
          <p style={styles.count}>{data.devices.length} registered device{data.devices.length === 1 ? "" : "s"}</p>
          {data.devices.slice(0, 5).map((device) => <div key={device.id} style={styles.row}><strong>{device.name}</strong><span>{device.zone.location.name} · {device.status}</span></div>)}
        </form>
      </section>
    </>}
  </main>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 20px 72px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontSize: 13, fontWeight: 900, letterSpacing: 1.2, textTransform: "uppercase" },
  title: { margin: 0, color: "#0f172a", fontSize: 36 },
  copy: { maxWidth: 800, color: "#475569", lineHeight: 1.6 },
  notice: { marginTop: 24, padding: 18, border: "1px solid #f59e0b", borderRadius: 10, background: "#fffbeb", color: "#78350f", fontWeight: 700 },
  message: { marginTop: 18, padding: 14, border: "1px solid #93c5fd", borderRadius: 9, background: "#eff6ff", color: "#1e3a8a", fontWeight: 700, overflowWrap: "anywhere" },
  grid: { marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignItems: "start" },
  card: { display: "grid", gap: 12, padding: 20, border: "1px solid #cbd5e1", borderRadius: 12, background: "#fff", boxShadow: "0 2px 8px rgba(15,23,42,.06)" },
  cardTitle: { margin: 0, color: "#0f172a", fontSize: 22 },
  small: { margin: 0, minHeight: 55, color: "#64748b", fontSize: 13, lineHeight: 1.5 },
  label: { display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 },
  input: { minHeight: 41, border: "1px solid #94a3b8", borderRadius: 7, padding: "8px 10px", background: "#fff", color: "#0f172a" },
  two: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  button: { minHeight: 42, border: 0, borderRadius: 7, padding: "10px 14px", background: "#0f172a", color: "#fff", fontWeight: 900, cursor: "pointer" },
  count: { margin: "8px 0 0", color: "#9a6400", fontSize: 12, fontWeight: 900, textTransform: "uppercase" },
  row: { display: "grid", gap: 3, paddingTop: 10, borderTop: "1px solid #e2e8f0", color: "#334155", fontSize: 13 }
};
