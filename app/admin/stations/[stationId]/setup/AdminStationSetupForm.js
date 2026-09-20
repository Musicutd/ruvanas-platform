"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminStationSetupForm({
  stationId,
  stationName,
  stationStatus,
  productFamily,
  hasStreamConfig,
  initialData
}) {
  const router = useRouter();

  const [form, setForm] = useState({
    streamUrl: initialData?.streamUrl || "",
    mountPoint: initialData?.mountPoint || "",
    serverHost: initialData?.serverHost || "",
    serverPort: initialData?.serverPort?.toString() || "",
    sourcePort: initialData?.sourcePort?.toString() || "",
    sourceUsername: initialData?.sourceUsername || "",
    outboundAutoDjEnabled: initialData?.outboundAutoDjEnabled === true,
    bitrateKbps: initialData?.bitrateKbps?.toString() || "",
    centovaUsername: initialData?.centovaUsername || "",
    providerKey: initialData?.providerKey || "CENTOVA_CAST",
    backupStreamUrl: initialData?.backupStreamUrl || "",
    probeEnabled: initialData?.probeEnabled !== false,
    probeIntervalSeconds: initialData?.probeIntervalSeconds?.toString() || "60",
    probeTimeoutMs: initialData?.probeTimeoutMs?.toString() || "8000",
    sourcePassword: ""
  });

  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [configured, setConfigured] = useState(hasStreamConfig);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(stationStatus);
  const [message, setMessage] = useState({
    type: "",
    text: ""
  });

  function updateField(event) {
    setDirty(true);
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.type === "checkbox" ? event.target.checked : event.target.value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.streamUrl.trim()) {
      setMessage({
        type: "error",
        text: "Please enter the stream URL."
      });
      return;
    }

    if (form.providerKey === "CENTOVA_CAST" && !form.serverHost.trim()) {
      setMessage({
        type: "error",
        text: "Please enter the server host."
      });
      return;
    }

    if (form.providerKey === "CENTOVA_CAST" && !form.serverPort.trim()) {
      setMessage({
        type: "error",
        text: "Please enter the server port."
      });
      return;
    }

    if (form.providerKey === "CENTOVA_CAST" && !form.centovaUsername.trim()) {
      setMessage({
        type: "error",
        text: "Please enter the Centova username."
      });
      return;
    }

    setSaving(true);
    setMessage({
      type: "",
      text: ""
    });

    try {
      /*
        Send only fields that the StreamConfig API/database accepts.
        `adminPassword` is intentionally not sent or stored.
      */
      const payload = {
        streamUrl: form.streamUrl.trim(),
        mountPoint: form.mountPoint.trim(),
        serverHost: form.serverHost.trim(),
        serverPort: Number(form.serverPort),
        sourcePort: form.sourcePort.trim() ? Number(form.sourcePort) : null,
        sourceUsername: form.sourceUsername.trim(),
        outboundAutoDjEnabled: form.outboundAutoDjEnabled,
        bitrateKbps: form.bitrateKbps.trim()
          ? Number(form.bitrateKbps)
          : null,
        centovaUsername: form.centovaUsername.trim(),
        providerKey: form.providerKey,
        backupStreamUrl: form.backupStreamUrl.trim(),
        probeEnabled: form.probeEnabled,
        probeIntervalSeconds: Number(form.probeIntervalSeconds),
        probeTimeoutMs: Number(form.probeTimeoutMs),
        sourcePassword: form.sourcePassword
      };

      const response = await fetch(`/api/stations/${stationId}/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({
          type: "error",
          text: data.error || "Unable to save streaming configuration."
        });
        return;
      }

      setMessage({
        type: "success",
        text: "Streaming configuration saved. Verify live audio and activate the station when ready."
      });
      setConfigured(true);
      setDirty(false);

      setForm((current) => ({
        ...current,
        sourcePassword: ""
      }));

      router.refresh();
    } catch {
      setMessage({
        type: "error",
        text: "A connection error occurred. Please try again."
      });
    } finally {
      setSaving(false);
    }
  }

  async function activateStation() {
    setActivating(true);
    setMessage({ type: "", text: "" });
    try {
      const response = await fetch(`/api/admin/stations/${stationId}/activate`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to activate the station.");
      setStatus("ACTIVE");
      setMessage({ type: "success", text: "Station activated after a healthy live-stream check. Online Radio channels are prepared automatically; retail channels still need a listening-zone assignment." });
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to activate the station." });
    } finally {
      setActivating(false);
    }
  }

  async function prepareChannel() {
    setPreparing(true);
    setMessage({ type: "", text: "" });
    try {
      const response = await fetch(`/api/admin/stations/${stationId}/prepare-channel`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to prepare the channel.");
      setMessage({ type: "success", text: "Online Radio channel prepared. The subscriber can now select it for Continuous AutoDJ. This does not mean audio is live yet." });
      router.refresh();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Unable to prepare the channel." });
    } finally {
      setPreparing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>1. Add the stream details</h2>
        <p style={styles.helpText}>Copy these values from this station’s Centova Quick Links and Stream settings. This saves the connection only; it does not start broadcasting.</p>

        <label style={styles.label}>
          Public stream URL (HTTPS preferred)
          <input
            style={styles.input}
            type="url"
            name="streamUrl"
            value={form.streamUrl}
            onChange={updateField}
            placeholder="https://your-station.radioca.st/stream"
            disabled={saving}
            required={form.providerKey === "CENTOVA_CAST"}
          />
        </label>

        <label style={styles.label}>
          {form.providerKey === "CENTOVA_CAST" ? "Centova server host" : "Server host (optional)"}
          <input
            style={styles.input}
            type="text"
            name="serverHost"
            value={form.serverHost}
            onChange={updateField}
            placeholder="pollux.shoutca.st"
            disabled={saving}
            required={form.providerKey === "CENTOVA_CAST"}
          />
        </label>

        <div style={styles.row}>
          <label style={styles.label}>
            {form.providerKey === "CENTOVA_CAST" ? "Listener/server port" : "Server port (optional)"}
            <input
              style={styles.input}
              type="number"
              name="serverPort"
              value={form.serverPort}
              onChange={updateField}
              placeholder="8000"
              min="1"
              max="65535"
              disabled={saving}
              required={form.providerKey === "CENTOVA_CAST"}
            />
          </label>

          {form.providerKey === "CENTOVA_CAST" ? <label style={styles.label}>Live-source port<input style={styles.input} type="number" name="sourcePort" value={form.sourcePort} onChange={updateField} min="1" max="65535" disabled={saving} placeholder="From Live Source Connections" /></label> : null}
        </div>
        {form.providerKey === "CENTOVA_CAST" ? <p style={styles.helpText}>Centova may use the same number for both ports. Use the exact “When the autoDJ is not running” live-source port, not the DJ-account port.</p> : null}
        {form.providerKey === "CENTOVA_CAST" ? <>
        <label style={styles.label}>
          Centova account username
          <input
            style={styles.input}
            type="text"
            name="centovaUsername"
            value={form.centovaUsername}
            onChange={updateField}
            placeholder="centova_account_name"
            disabled={saving}
            required
          />
        </label>

        <label style={styles.label}>
          Centova source password{" "}
          <span style={styles.optional}>
            (leave blank to keep the existing value)
          </span>
          <input
            style={styles.input}
            type="password"
            name="sourcePassword"
            value={form.sourcePassword}
            onChange={updateField}
            placeholder="••••••••"
            disabled={saving}
          />
        </label>

        <p style={styles.helpText}>This is the source password, not the Centova administrator password. Leave it blank to keep a password already saved in Ruvanas.</p>
        </> : null}
      </section>

      {form.providerKey === "CENTOVA_CAST" ? <section style={styles.section}>
        <h2 style={styles.sectionTitle}>2. Allow Ruvanas audio when ready</h2>
        <label style={styles.checkLabel}><input type="checkbox" name="outboundAutoDjEnabled" checked={form.outboundAutoDjEnabled} onChange={updateField} disabled={saving} />Allow the dedicated Ruvanas AutoDJ worker to connect to this Centova stream</label>
        <p style={styles.helpText}>Leave this off until the Online Radio channel, rights-approved music mode and dedicated encoder worker are ready. Turning it on does not start audio by itself. Stop Centova AutoDJ before Ruvanas connects as the source.</p>
      </section> : null}

      <details style={styles.advanced}>
        <summary style={styles.advancedSummary}>Advanced settings (usually leave unchanged)</summary>
        <div style={styles.advancedContent}>
          <label style={styles.label}>Provider adapter<select style={styles.input} name="providerKey" value={form.providerKey} onChange={updateField} disabled={saving}><option value="CENTOVA_CAST">Centova Cast</option><option value="GENERIC_HTTP">Generic HTTP stream</option></select></label>
          <label style={styles.label}>Mount point <span style={styles.optional}>(only if supplied by the provider)</span><input style={styles.input} type="text" name="mountPoint" value={form.mountPoint} onChange={updateField} placeholder="/stream" disabled={saving} /></label>
          <label style={styles.label}>Bitrate (kbps) <span style={styles.optional}>(optional)</span><input style={styles.input} type="number" name="bitrateKbps" value={form.bitrateKbps} onChange={updateField} placeholder="128" min="8" max="320" disabled={saving} /></label>
          {form.providerKey === "CENTOVA_CAST" ? <label style={styles.label}>Live-source username <span style={styles.optional}>(only if Centova supplies one)</span><input style={styles.input} type="text" name="sourceUsername" value={form.sourceUsername} onChange={updateField} maxLength={120} disabled={saving} placeholder="Leave blank for source-password-only Shoutcast v1" /></label> : null}
          <label style={styles.label}>Backup stream URL <span style={styles.optional}>(recorded only; no automatic switch)</span><input style={styles.input} type="url" name="backupStreamUrl" value={form.backupStreamUrl} onChange={updateField} placeholder="https://backup.example.com/live" disabled={saving} /></label>
          <label style={styles.checkLabel}><input type="checkbox" name="probeEnabled" checked={form.probeEnabled} onChange={updateField} disabled={saving} />Monitor the public stream source</label>
          <div style={styles.row}>
            <label style={styles.label}>Probe interval (seconds)<input style={styles.input} type="number" name="probeIntervalSeconds" value={form.probeIntervalSeconds} onChange={updateField} min="30" max="3600" disabled={saving} required /></label>
            <label style={styles.label}>Probe timeout (milliseconds)<input style={styles.input} type="number" name="probeTimeoutMs" value={form.probeTimeoutMs} onChange={updateField} min="1000" max="30000" disabled={saving} required /></label>
          </div>
          <p style={styles.helpText}>Private-network and redirect targets are not followed. Ruvanas opens incidents only after repeated failures.</p>
        </div>
      </details>

      {message.text ? (
        <p
          style={{
            ...styles.message,
            ...(message.type === "error"
              ? styles.messageError
              : styles.messageSuccess)
          }}
        >
          {message.text}
        </p>
      ) : null}

      <button type="submit" style={styles.button} disabled={saving}>
        {saving ? "Saving…" : "Save configuration"}
      </button>
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>3. Check audio and activate</h2>
        {productFamily === "ONLINE" ? <><p style={styles.helpText}>Step 1: Prepare the Online Radio channel. Step 2: The subscriber selects a rights-approved music mode and enables Continuous AutoDJ. Step 3: Once the dedicated encoder sends audio to Centova, check the stream and activate the station.</p><button type="button" style={styles.button} disabled={!configured || dirty || saving || preparing} onClick={prepareChannel}>{preparing ? "Preparing channel…" : "Prepare Online Radio channel"}</button></> : null}
        {productFamily === "ONLINE" ? <p style={styles.helpText}>Encoder worker lease: {initialData.encoderLeaseUntil && new Date(initialData.encoderLeaseUntil) > new Date() ? "active (connection not yet verified)" : "not active"}. A lease means a worker is assigned, not that Centova is receiving audio.</p> : null}
        <p style={styles.helpText}>Last stream check: {initialData.sourceConnectionStatus}{initialData.lastProbeHttpStatus ? ` · HTTP ${initialData.lastProbeHttpStatus}` : ""}{initialData.lastError === "REDIRECT_NOT_FOLLOWED" ? " · the URL redirected instead of returning audio" : ""}.</p>
        <p style={styles.helpText}>{status === "ACTIVE"
          ? "This station is active. Publishing its public player is a separate subscriber action."
          : "Super Admin activates the station only after its saved public stream returns healthy audio. A failed check leaves the station pending."}</p>
        {status !== "ACTIVE" ? <button type="button" style={styles.button} disabled={!configured || dirty || saving || activating} onClick={activateStation}>
          {activating ? "Checking live stream…" : "Check stream and activate station"}
        </button> : null}
        {dirty ? <p style={styles.helpText}>Save your changes before running the live check.</p> : null}
      </section>
    </form>
  );
}

const styles = {
  form: {
    display: "grid",
    gap: 28
  },
  section: {
    background: "#182235",
    border: "1px solid #2b3a54",
    borderRadius: 14,
    padding: 24,
    display: "grid",
    gap: 18
  },
  sectionTitle: {
    color: "#f4b942",
    fontSize: 14,
    fontWeight: 700,
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  advanced: {
    background: "#182235",
    border: "1px solid #2b3a54",
    borderRadius: 14,
    padding: 24
  },
  advancedSummary: {
    color: "#d8e0ec",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 800
  },
  advancedContent: {
    display: "grid",
    gap: 18,
    marginTop: 20
  },
  label: {
    display: "grid",
    gap: 8,
    color: "#d8e0ec",
    fontSize: 14,
    fontWeight: 700
  },
  optional: {
    color: "#94a3b8",
    fontWeight: 500
  },
  helpText: {
    margin: 0,
    color: "#aebcd0",
    fontSize: 13,
    lineHeight: 1.5
  },
  checkLabel: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    color: "#d8e0ec",
    fontSize: 14,
    fontWeight: 700
  },
  input: {
    width: "100%",
    border: "1px solid #42526b",
    borderRadius: 8,
    background: "#0f1725",
    color: "#ffffff",
    padding: "13px 14px",
    boxSizing: "border-box",
    fontSize: 15
  },
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16
  },
  message: {
    margin: 0,
    borderRadius: 8,
    padding: 12,
    lineHeight: 1.45,
    fontSize: 14
  },
  messageError: {
    border: "1px solid #a63e4a",
    background: "#3c1d27",
    color: "#fecdd3"
  },
  messageSuccess: {
    border: "1px solid #2d7a4f",
    background: "#1a3a2f",
    color: "#c6f6d5"
  },
  button: {
    border: "none",
    borderRadius: 8,
    background: "#f4b942",
    color: "#101827",
    padding: "14px 18px",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    alignSelf: "start"
  }
};
