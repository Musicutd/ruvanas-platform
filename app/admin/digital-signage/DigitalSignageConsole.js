"use client";

import { useEffect, useMemo, useState } from "react";

const emptyData = { assets: [], layouts: [], devices: [], playlists: [], takeovers: [] };

export default function DigitalSignageConsole({ organisations, showOrganisationSelector = true, locationsHref = "/admin/locations" }) {
  const enabledOrganisations = organisations.filter((item) => item.digitalSignageEnabled);
  const [organisationId, setOrganisationId] = useState(enabledOrganisations[0]?.id || "");
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [activeTab, setActiveTab] = useState("displays");
  const [deviceFeedback, setDeviceFeedback] = useState(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [playlistFeedback, setPlaylistFeedback] = useState(null);
  const selected = useMemo(() => organisations.find((item) => item.id === organisationId), [organisationId, organisations]);
  const zones = selected?.locations.flatMap((location) => location.zones.map((zone) => ({ ...zone, locationName: location.name }))) || [];
  const readyAssets = data.assets.filter((asset) => asset.status === "READY");
  const playlistBlocker = !readyAssets.length
    ? "Add a ready visual first"
    : !data.layouts.length
      ? "Create a layout first"
      : !data.devices.length
        ? "Add a display device first"
        : "";

  async function load() {
    if (!organisationId) { setData(emptyData); return; }
    setLoading(true); setMessage("");
    try {
      const query = `?organisationId=${encodeURIComponent(organisationId)}`;
      const [assetsResponse, layoutsResponse, devicesResponse, playlistsResponse, takeoversResponse] = await Promise.all([
        fetch(`/api/admin/digital-signage/assets${query}`),
        fetch(`/api/admin/digital-signage/layouts${query}`),
        fetch(`/api/admin/digital-signage/devices${query}`),
        fetch(`/api/admin/digital-signage/playlists${query}`),
        fetch(`/api/admin/digital-signage/takeovers${query}`)
      ]);
      const [assets, layouts, devices, playlists, takeovers] = await Promise.all([assetsResponse.json(), layoutsResponse.json(), devicesResponse.json(), playlistsResponse.json(), takeoversResponse.json()]);
      const failed = [[assetsResponse, assets], [layoutsResponse, layouts], [devicesResponse, devices], [playlistsResponse, playlists], [takeoversResponse, takeovers]].find(([response]) => !response.ok);
      if (failed) throw new Error(failed[1].error || "Unable to load the signage workspace.");
      setData({ assets: assets.assets, layouts: layouts.layouts, devices: devices.devices, playlists: playlists.playlists, takeovers: takeovers.takeovers });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load the signage workspace."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [organisationId]);

  async function uploadAsset(event) {
    event.preventDefault(); setBusy("asset"); setMessage("");
    const form = event.currentTarget;
    try {
      const formData = new FormData(form);
      formData.set("organisationId", organisationId);
      const response = await fetch("/api/admin/digital-signage/assets", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to upload the visual.");
      form.reset();
      await load();
      setMessage(result.duplicate ? "This visual already exists in the library." : result.asset.kind === "VIDEO" ? "Video uploaded. Protected processing is now running; refresh shortly to see when it is ready." : "Visual asset uploaded safely.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to upload the visual."); }
    finally { setBusy(""); }
  }

  async function createLayout(event) {
    event.preventDefault(); setBusy("layout"); setMessage("");
    const form = event.currentTarget;
    const formData = new FormData(form);
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
      form.reset(); await load(); setMessage("Reusable full-screen layout created.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create the layout."); }
    finally { setBusy(""); }
  }

  async function createDevice(event) {
    event.preventDefault(); setBusy("device"); setMessage(""); setDeviceFeedback(null); setCodeCopied(false);
    const form = event.currentTarget;
    const formData = new FormData(form);
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
      form.reset();
      await load();
      setDeviceFeedback({
        tone: "success",
        title: `${result.device.name} is ready to connect`,
        text: "Copy this one-time code to the screen that will show your Digital Signage content.",
        code: result.device.enrolmentCode,
        expiresAt: result.device.enrolmentExpiresAt
      });
    } catch (error) { setDeviceFeedback({ tone: "error", text: error instanceof Error ? error.message : "Unable to create the device." }); }
    finally { setBusy(""); }
  }

  async function copyEnrolmentCode() {
    if (!deviceFeedback?.code) return;
    try {
      await navigator.clipboard.writeText(deviceFeedback.code);
      setCodeCopied(true);
    } catch {
      setCodeCopied(false);
    }
  }

  async function createPlaylist(event) {
    event.preventDefault(); setBusy("playlist"); setMessage(""); setPlaylistFeedback(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const layout = data.layouts.find((item) => item.id === formData.get("layoutId"));
    try {
      if (!layout?.regions?.[0]) throw new Error("Create a layout with at least one region first.");
      const response = await fetch("/api/admin/digital-signage/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        organisationId,
        name: formData.get("name"),
        layoutId: layout.id,
        deviceIds: formData.getAll("deviceIds"),
        activeDays: [0, 1, 2, 3, 4, 5, 6],
        dailyStart: formData.get("dailyStart"),
        dailyEnd: formData.get("dailyEnd"),
        priority: Number(formData.get("priority")),
        items: [{ regionId: layout.regions[0].id, assetId: formData.get("assetId"), durationSeconds: Number(formData.get("durationSeconds")) }]
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create the visual playlist.");
      form.reset(); await load(); setPlaylistFeedback({ tone: "success", text: "Visual playlist saved as a draft. Review it below, then publish it to the assigned display." });
    } catch (error) { setPlaylistFeedback({ tone: "error", text: error instanceof Error ? error.message : "Unable to create the visual playlist." }); }
    finally { setBusy(""); }
  }

  async function updatePlaylist(playlistId, action) {
    setBusy(playlistId); setMessage("");
    try {
      const response = await fetch(`/api/admin/digital-signage/playlists/${playlistId}/publish`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update the visual playlist.");
      await load(); setMessage(action === "PUBLISH" ? "Visual playlist published. Assigned displays will receive it securely." : "Visual playlist paused.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update the visual playlist."); }
    finally { setBusy(""); }
  }

  async function createTakeover(event) {
    event.preventDefault(); setBusy("takeover"); setMessage("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const response = await fetch("/api/admin/digital-signage/takeovers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organisationId, name: formData.get("name"), reason: formData.get("reason"), playlistId: formData.get("playlistId"), deviceIds: formData.getAll("deviceIds"), startsAt: new Date(String(formData.get("startsAt"))).toISOString(), endsAt: new Date(String(formData.get("endsAt"))).toISOString() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to create the visual takeover.");
      form.reset(); await load(); setMessage("Takeover draft created. A manager must explicitly activate it.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create the visual takeover."); }
    finally { setBusy(""); }
  }

  async function updateTakeover(takeoverId, action) {
    setBusy(takeoverId); setMessage("");
    try {
      const response = await fetch(`/api/admin/digital-signage/takeovers/${takeoverId}/action`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update the visual takeover.");
      await load(); setMessage(action === "ACTIVATE" ? "Takeover activated. Selected displays will switch on their next secure refresh." : "Takeover closed safely.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update the visual takeover."); }
    finally { setBusy(""); }
  }

  return <main style={styles.page}>
    <p style={styles.eyebrow}>{showOrganisationSelector ? "Ruvanas operations" : "Visual content & displays"}</p>
    <h1 style={styles.title}>{showOrganisationSelector ? "Advanced Digital Signage" : "Digital Signage workspace"}</h1>
    <p style={styles.copy}>Connect your screens, add visual content, and publish what each display should show. Work through one tab at a time.</p>

    {showOrganisationSelector ? <label style={styles.label}>Organisation
      <select value={organisationId} onChange={(event) => setOrganisationId(event.target.value)} style={styles.input}>
        <option value="">Select an enabled organisation</option>
        {enabledOrganisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label> : null}

    {!organisationId ? <section style={styles.notice}>Digital Signage must be enabled for an organisation before visual content or devices can be prepared.</section> : <>
      {message ? <section style={styles.message}>{message}</section> : null}
      {loading ? <p style={styles.copy}>Refreshing workspace…</p> : null}
      <nav style={styles.tabs} aria-label="Digital Signage tools">
        {[
          { id: "displays", label: "Displays", detail: "Connect screens", count: data.devices.length },
          { id: "content", label: "Visuals & layouts", detail: "Prepare content", count: data.assets.length + data.layouts.length },
          { id: "playlists", label: "Playlists", detail: "Schedule and publish", count: data.playlists.length },
          { id: "takeovers", label: "Takeovers", detail: "Temporary overrides", count: data.takeovers.length }
        ].map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? "page" : undefined} style={activeTab === tab.id ? styles.activeTab : styles.tab}>
          <span style={styles.tabLabel}>{tab.label}<small style={styles.tabCount}>{tab.count}</small></span>
          <small style={styles.tabDetail}>{tab.detail}</small>
        </button>)}
      </nav>
      <section style={styles.grid}>
        {activeTab === "content" ? <>
        <form onSubmit={uploadAsset} style={styles.card}>
          <h2 style={styles.cardTitle}>Visual library</h2>
          <p style={styles.small}>PNG/JPEG up to 15 MB or MP4/WebM up to 80 MB. Videos enter protected normalization and cannot be published until verified.</p>
          <label style={styles.label}>Display name<input name="name" required maxLength={200} style={styles.input} /></label>
          <label style={styles.label}>Image or video<input name="file" type="file" required accept="image/png,image/jpeg,video/mp4,video/webm" style={styles.input} /></label>
          <button disabled={busy === "asset"} style={styles.button}>{busy === "asset" ? "Uploading…" : "Upload visual"}</button>
          <p style={styles.count}>{data.assets.length} active visual asset{data.assets.length === 1 ? "" : "s"}</p>
          {data.assets.slice(0, 5).map((asset) => <div key={asset.id} style={styles.row}><strong>{asset.name}</strong><span>{asset.kind} · {asset.status}{asset.width ? ` · ${asset.width}×${asset.height}` : ""} · {(Number(asset.sizeBytes) / 1048576).toFixed(1)} MB</span>{asset.videoJob?.status === "FAILED" ? <span style={styles.errorText}>{asset.videoJob.errorMessage || "Protected video processing failed."}</span> : null}</div>)}
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
        </> : null}

        {activeTab === "displays" ?
        <form id="display-devices" onSubmit={createDevice} style={styles.card}>
          <h2 style={styles.cardTitle}>Display devices</h2>
          <p style={styles.small}>Add the TV or screen here, then use its one-time code on the separate display page. This is different from an audio player.</p>
          {zones.length === 0 ? <div style={styles.emptyState}><strong>Before adding a display, create the location and area where this screen will operate.</strong><a href={locationsHref} style={styles.emptyAction}>Create location / area</a></div> : <>
            <label style={styles.label}>Device name<input name="name" required maxLength={200} style={styles.input} /></label>
            <label style={styles.label}>Location and zone<select name="zoneId" required defaultValue={zones.length === 1 ? zones[0].id : ""} style={styles.input}><option value="">Select a zone</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.locationName} — {zone.name}</option>)}</select>{zones.length === 1 ? <span style={styles.choiceHint}>Your only location and area is selected automatically.</span> : null}</label>
            <div style={styles.two}><label style={styles.label}>Screen width<input name="viewportWidth" type="number" min="320" max="8192" defaultValue="1920" required style={styles.input} /></label><label style={styles.label}>Screen height<input name="viewportHeight" type="number" min="240" max="8192" defaultValue="1080" required style={styles.input} /></label></div>
            <button disabled={busy === "device"} style={styles.button}>{busy === "device" ? "Creating…" : "Create device enrolment"}</button>
          </>}
          {deviceFeedback ? <div role={deviceFeedback.tone === "error" ? "alert" : "status"} style={deviceFeedback.tone === "error" ? styles.localError : styles.enrolmentResult}>
            {deviceFeedback.title ? <strong style={styles.resultTitle}>{deviceFeedback.title}</strong> : null}
            <span>{deviceFeedback.text}</span>
            {deviceFeedback.code ? <>
              <label style={styles.codeLabel}>One-time display code
                <input value={deviceFeedback.code} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="One-time display enrolment code" style={styles.codeInput} />
              </label>
              <div style={styles.resultActions}>
                <button type="button" onClick={copyEnrolmentCode} style={styles.smallButton}>{codeCopied ? "Code copied" : "Copy code"}</button>
                <a href="/signage" target="_blank" rel="noreferrer" style={styles.openDisplay}>Open display screen</a>
              </div>
              <small style={styles.resultHint}>Paste only the code shown above. It expires after 24 hours and can be used once.</small>
            </> : null}
          </div> : null}
          <p style={styles.count}>{data.devices.length} registered device{data.devices.length === 1 ? "" : "s"}</p>
          {data.devices.slice(0, 5).map((device) => <div key={device.id} style={styles.row}><strong>{device.name}</strong><span>{device.zone.location.name} · {device.status}</span></div>)}
        </form>
        : null}

        {activeTab === "playlists" ?
        <form onSubmit={createPlaylist} style={styles.card}>
          <h2 style={styles.cardTitle}>Scheduled visual playlists</h2>
          <p style={styles.small}>Create a reviewed draft, choose its displays, and publish it when ready.</p>
          <label style={styles.label}>Playlist name<input name="name" required maxLength={200} style={styles.input} /></label>
          <label style={styles.label}>Layout<select name="layoutId" required style={styles.input}><option value="">Select a layout</option>{data.layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select></label>
          <label style={styles.label}>Visual asset<select name="assetId" required style={styles.input}><option value="">Select a ready visual</option>{readyAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} — {asset.kind}</option>)}</select></label>
          {!data.devices.length ? <div style={styles.emptyState}><strong>No display device is registered yet.</strong><span>Create the screen in Display devices above. It will appear here automatically.</span><a href="#display-devices" style={styles.emptyAction}>Add a display device</a></div> : <fieldset style={styles.choiceFieldset}>
            <legend style={styles.choiceLegend}>Display devices</legend>
            <div style={styles.deviceChoices}>{data.devices.map((device) => <label key={device.id} style={styles.deviceChoice}><input type="checkbox" name="deviceIds" value={device.id} defaultChecked={data.devices.length === 1} /> <span style={styles.deviceChoiceText}><strong>{device.name}</strong><small>{device.zone.location.name} · {device.zone.name}</small></span></label>)}</div>
            <span style={styles.choiceHint}>{data.devices.length === 1 ? "Your only display is selected automatically." : "Select every display that should receive this playlist."}</span>
          </fieldset>}
          <div style={styles.two}><label style={styles.label}>Daily start<input name="dailyStart" type="time" defaultValue="06:00" required style={styles.input} /></label><label style={styles.label}>Daily end<input name="dailyEnd" type="time" defaultValue="23:00" required style={styles.input} /></label></div>
          <div style={styles.two}><label style={styles.label}>Seconds per visual<input name="durationSeconds" type="number" min="3" max="86400" defaultValue="10" required style={styles.input} /></label><label style={styles.label}>Priority<input name="priority" type="number" min="0" max="100" defaultValue="0" required style={styles.input} /></label></div>
          <button disabled={busy === "playlist" || Boolean(playlistBlocker)} style={styles.button}>{busy === "playlist" ? "Creating…" : playlistBlocker || "Create playlist draft"}</button>
          {playlistFeedback ? <div role={playlistFeedback.tone === "error" ? "alert" : "status"} style={playlistFeedback.tone === "error" ? styles.localError : styles.localSuccess}>{playlistFeedback.text}</div> : null}
          <p style={styles.count}>{data.playlists.length} visual playlist{data.playlists.length === 1 ? "" : "s"}</p>
          {data.playlists.slice(0, 8).map((playlist) => <div key={playlist.id} style={styles.row}>
            <strong>{playlist.name}</strong><span>{playlist.layout.name} · {playlist.status} · priority {playlist.priority}</span>
            <button type="button" disabled={busy === playlist.id} onClick={() => updatePlaylist(playlist.id, playlist.status === "PUBLISHED" ? "PAUSE" : "PUBLISH")} style={styles.smallButton}>{playlist.status === "PUBLISHED" ? "Pause" : "Publish"}</button>
          </div>)}
        </form>
        : null}

        {activeTab === "takeovers" ?
        <form onSubmit={createTakeover} style={styles.card}>
          <h2 style={styles.cardTitle}>Time-bounded visual takeover</h2>
          <p style={styles.small}>A manager-controlled override for urgent operational messages. It expires automatically and does not replace certified fire, safety, or emergency alarm systems.</p>
          <label style={styles.label}>Takeover name<input name="name" required maxLength={200} style={styles.input} /></label>
          <label style={styles.label}>Operational reason<textarea name="reason" required maxLength={1000} rows={3} style={styles.input} /></label>
          <label style={styles.label}>Published playlist<select name="playlistId" required style={styles.input}><option value="">Select a published playlist</option>{data.playlists.filter((playlist) => playlist.status === "PUBLISHED").map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select></label>
          <label style={styles.label}>Displays<select name="deviceIds" required multiple size={Math.min(5, Math.max(2, data.devices.length))} style={styles.input}>{data.devices.filter((device) => device.status !== "DISABLED").map((device) => <option key={device.id} value={device.id}>{device.name} — {device.zone.location.name}</option>)}</select></label>
          <div style={styles.two}><label style={styles.label}>Starts<input name="startsAt" type="datetime-local" required style={styles.input} /></label><label style={styles.label}>Ends (within 24h)<input name="endsAt" type="datetime-local" required style={styles.input} /></label></div>
          <button disabled={busy === "takeover"} style={styles.button}>{busy === "takeover" ? "Creating…" : "Create takeover draft"}</button>
          <p style={styles.count}>{data.takeovers.length} takeover record{data.takeovers.length === 1 ? "" : "s"}</p>
          {data.takeovers.slice(0, 8).map((takeover) => <div key={takeover.id} style={styles.row}><strong>{takeover.name}</strong><span>{takeover.status} · {takeover.devices.length} display{takeover.devices.length === 1 ? "" : "s"} · ends {new Date(takeover.endsAt).toLocaleString()}</span>{takeover.status === "DRAFT" ? <div style={styles.actions}><button type="button" disabled={busy === takeover.id} onClick={() => updateTakeover(takeover.id, "ACTIVATE")} style={styles.smallButton}>Activate</button><button type="button" disabled={busy === takeover.id} onClick={() => updateTakeover(takeover.id, "CANCEL")} style={styles.smallButton}>Cancel</button></div> : takeover.status === "ACTIVE" ? <button type="button" disabled={busy === takeover.id} onClick={() => updateTakeover(takeover.id, "END")} style={styles.smallButton}>End now</button> : null}</div>)}
        </form>
        : null}
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
  tabs: { marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, padding: 8, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f1f5f9" },
  tab: { display: "grid", gap: 4, minHeight: 66, padding: "11px 13px", border: "1px solid transparent", borderRadius: 8, background: "transparent", color: "#475569", cursor: "pointer", textAlign: "left" },
  activeTab: { display: "grid", gap: 4, minHeight: 66, padding: "11px 13px", border: "1px solid #d69b1f", borderRadius: 8, background: "#fff7df", color: "#0f172a", cursor: "pointer", textAlign: "left", boxShadow: "0 1px 3px rgba(15,23,42,.08)" },
  tabLabel: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 14, fontWeight: 900 },
  tabCount: { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, padding: "0 6px", borderRadius: 999, background: "#e2e8f0", color: "#334155", fontSize: 11 },
  tabDetail: { color: "#64748b", fontSize: 11 },
  grid: { marginTop: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignItems: "start" },
  card: { display: "grid", gap: 12, padding: 20, border: "1px solid #cbd5e1", borderRadius: 12, background: "#fff", boxShadow: "0 2px 8px rgba(15,23,42,.06)" },
  cardTitle: { margin: 0, color: "#0f172a", fontSize: 22 },
  small: { margin: 0, minHeight: 55, color: "#64748b", fontSize: 13, lineHeight: 1.5 },
  label: { display: "grid", gap: 6, color: "#334155", fontSize: 13, fontWeight: 800 },
  input: { minHeight: 41, border: "1px solid #94a3b8", borderRadius: 7, padding: "8px 10px", background: "#fff", color: "#0f172a" },
  two: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  button: { minHeight: 42, border: 0, borderRadius: 7, padding: "10px 14px", background: "#0f172a", color: "#fff", fontWeight: 900, cursor: "pointer" },
  smallButton: { justifySelf: "start", minHeight: 34, border: "1px solid #0f172a", borderRadius: 6, padding: "6px 10px", background: "#fff", color: "#0f172a", fontWeight: 800, cursor: "pointer" },
  count: { margin: "8px 0 0", color: "#9a6400", fontSize: 12, fontWeight: 900, textTransform: "uppercase" },
  row: { display: "grid", gap: 3, paddingTop: 10, borderTop: "1px solid #e2e8f0", color: "#334155", fontSize: 13 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  errorText: { color: "#b91c1c", fontWeight: 700 },
  localSuccess: { padding: 11, borderRadius: 7, border: "1px solid #16a34a", background: "#f0fdf4", color: "#166534", fontSize: 13, fontWeight: 800, overflowWrap: "anywhere" },
  localError: { padding: 11, borderRadius: 7, border: "1px solid #dc2626", background: "#fef2f2", color: "#991b1b", fontSize: 13, fontWeight: 800, overflowWrap: "anywhere" },
  enrolmentResult: { display: "grid", gap: 10, padding: 15, borderRadius: 9, border: "1px solid #16a34a", background: "#f0fdf4", color: "#166534", fontSize: 13, overflowWrap: "anywhere" },
  resultTitle: { fontSize: 16 },
  codeLabel: { display: "grid", gap: 6, color: "#14532d", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: .5 },
  codeInput: { width: "100%", boxSizing: "border-box", minHeight: 43, border: "1px solid #16a34a", borderRadius: 7, padding: "9px 10px", background: "#fff", color: "#0f172a", fontFamily: "monospace", fontSize: 13 },
  resultActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  openDisplay: { display: "inline-flex", alignItems: "center", minHeight: 34, borderRadius: 6, padding: "6px 11px", background: "#0f172a", color: "#fff", fontWeight: 900, textDecoration: "none" },
  resultHint: { color: "#166534", lineHeight: 1.45 },
  choiceFieldset: { display: "grid", gap: 9, minWidth: 0, margin: 0, padding: 12, border: "1px solid #94a3b8", borderRadius: 7 },
  choiceLegend: { padding: "0 5px", color: "#334155", fontSize: 13, fontWeight: 800 },
  deviceChoices: { display: "grid", gap: 8 },
  deviceChoice: { display: "flex", alignItems: "flex-start", gap: 8, padding: 9, borderRadius: 6, background: "#f8fafc", color: "#0f172a", cursor: "pointer" },
  deviceChoiceText: { display: "grid", gap: 2 },
  choiceHint: { color: "#64748b", fontSize: 12 },
  emptyState: { display: "grid", justifyItems: "start", gap: 12, padding: 15, borderRadius: 9, border: "1px solid #f59e0b", background: "#fffbeb", color: "#78350f", lineHeight: 1.5 },
  emptyAction: { display: "inline-flex", padding: "9px 12px", borderRadius: 7, background: "#0f172a", color: "#fff", fontWeight: 900, textDecoration: "none" }
};
