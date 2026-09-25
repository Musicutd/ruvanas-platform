"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const field = { display: "grid", gap: 6, fontWeight: 700, fontSize: 14 };
const input = { width: "100%", minHeight: 40, padding: "8px 10px", border: "1px solid #8da0b5", borderRadius: 7, background: "#fff", color: "#152335", boxSizing: "border-box" };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 };
const section = { marginTop: 28, padding: 20, border: "1px solid #52657a", borderRadius: 12, background: "#17283b" };
const button = { border: 0, borderRadius: 7, background: "#f4b942", color: "#172033", fontWeight: 800, padding: "10px 16px", cursor: "pointer" };

export default function AdminStreamingProfiles({ stationId, channels, destinations, liveSources }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [credentialType, setCredentialType] = useState("NONE");
  const [message, setMessage] = useState("");
  const endpoint = `/api/admin/stations/${stationId}/streaming-profiles`;

  async function submit(event, kind) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = { ...Object.fromEntries(new FormData(form).entries()), kind };
    if (kind === "STUDIO_DESTINATION") payload.isBackup = payload.isBackup === "on";
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the streaming profile.");
      form.reset();
      setCredentialType("NONE");
      setMessage(result.notice || "Streaming profile saved.");
      router.refresh();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function setEnabled(destination) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationId: destination.id, enabled: !destination.enabled }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update this destination.");
      setMessage(result.destination.enabled ? "Destination enabled." : "Destination disabled.");
      router.refresh();
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return <>
    <section style={section} aria-labelledby="admin-streaming-profiles-title">
      <h2 id="admin-streaming-profiles-title">Studio broadcast destinations</h2>
      <p>Only Super Admin can add or enable Icecast and SHOUTcast destinations. Saving a profile does not start a broadcast.</p>
      {destinations.length ? <ul>{destinations.map((destination) => <li key={destination.id} style={{ marginBottom: 10 }}>
        <strong>{destination.name}</strong> · {destination.type} · {destination.enabled ? "Enabled" : "Disabled"}
        <button type="button" disabled={busy} onClick={() => setEnabled(destination)} style={{ ...button, marginLeft: 10, padding: "6px 10px" }}>{destination.enabled ? "Disable" : "Enable"}</button>
      </li>)}</ul> : <p>No additional Studio destinations have been configured for this station.</p>}
      <form onSubmit={(event) => submit(event, "STUDIO_DESTINATION")} style={{ display: "grid", gap: 14, marginTop: 18 }}>
        <div style={grid}>
          <label style={field}>Profile name<input style={input} name="name" required minLength={2} maxLength={120} /></label>
          <label style={field}>Type<select style={input} name="type"><option value="ICECAST">Icecast</option><option value="SHOUTCAST">SHOUTcast</option></select></label>
          <label style={field}>Host<input style={input} name="host" required maxLength={253} /></label>
          <label style={field}>Port<input style={input} name="port" type="number" required min={1} max={65535} /></label>
          <label style={field}>Mount or service identifier<input style={input} name="mountOrService" required maxLength={160} /></label>
          <label style={field}>Codec<select style={input} name="codec"><option value="MP3">MP3</option><option value="AAC">AAC</option></select></label>
          <label style={field}>Bitrate (kbps)<select style={input} name="bitrateKbps" defaultValue="128">{[64, 96, 128, 160, 192, 256, 320].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label style={field}>Primary / backup group<input style={input} name="primaryGroup" maxLength={80} /></label>
          <label style={field}>Source credential<input style={input} name="credential" type="password" autoComplete="new-password" required /></label>
        </div>
        <label><input name="isBackup" type="checkbox" /> Use as backup in this group</label>
        <button type="submit" disabled={busy} style={button}>Save destination</button>
      </form>
    </section>

    <section style={section} aria-labelledby="admin-live-sources-title">
      <h2 id="admin-live-sources-title">External live sources</h2>
      <p>Super Admin enters the incoming source URL and any credential. The subscriber can test and control a prepared live source, but cannot change these details.</p>
      {liveSources.length ? <ul>{liveSources.map((source) => <li key={source.id}><strong>{source.name}</strong> · {source.channel?.name} · {source.status}</li>)}</ul> : <p>No external live sources have been configured for this station.</p>}
      {channels.length ? <form onSubmit={(event) => submit(event, "EXTERNAL_LIVE_SOURCE")} style={{ display: "grid", gap: 14, marginTop: 18 }}>
        <div style={grid}>
          <label style={field}>Source name<input style={input} name="name" required minLength={2} maxLength={120} /></label>
          <label style={field}>Channel<select style={input} name="channelId" required><option value="">Choose channel</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
          <label style={field}>Provider<select style={input} name="providerKey"><option value="GENERIC_HTTP">Generic HTTP audio</option><option value="ICECAST">Icecast</option><option value="SHOUTCAST">SHOUTcast</option></select></label>
          <label style={field}>Public audio URL<input style={input} name="streamUrl" type="url" required placeholder="https://audio.example.com/live" /></label>
          <label style={field}>Authentication<select style={input} name="credentialType" value={credentialType} onChange={(event) => setCredentialType(event.target.value)}><option value="NONE">None</option><option value="BASIC">Username and password</option><option value="BEARER">Bearer token</option></select></label>
          {credentialType === "BASIC" ? <label style={field}>Username<input style={input} name="credentialUsername" required autoComplete="off" /></label> : null}
          {credentialType !== "NONE" ? <label style={field}>{credentialType === "BEARER" ? "Access token" : "Password"}<input style={input} name="credentialSecret" type="password" required autoComplete="new-password" /></label> : null}
          <label style={field}>Live from (optional)<input style={input} name="startsAt" type="datetime-local" /></label>
          <label style={field}>Live until (optional)<input style={input} name="endsAt" type="datetime-local" /></label>
        </div>
        <button type="submit" disabled={busy} style={button}>Save live source</button>
      </form> : <p>Prepare an active channel for this station before adding a live source.</p>}
    </section>
    {message ? <p role="status" style={{ marginTop: 18, fontWeight: 800 }}>{message}</p> : null}
  </>;
}
