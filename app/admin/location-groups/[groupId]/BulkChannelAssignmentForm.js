"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildGroupAssignmentPreview } from "@/lib/group-channel-assignments.mjs";

export default function BulkChannelAssignmentForm({
  groupId,
  locations,
  channels
}) {
  const router = useRouter();
  const [channelId, setChannelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [verifiedPreview, setVerifiedPreview] = useState(null);
  const [message, setMessage] = useState({ type: "", text: "" });
  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const preview = useMemo(
    () => buildGroupAssignmentPreview(locations, channelId),
    [locations, channelId]
  );

  async function verifyPreview() {
    if (!channelId) {
      return;
    }

    setPreviewing(true);
    setVerifiedPreview(null);
    setMessage({ type: "", text: "" });

    try {
      const response = await fetch(
        `/api/admin/location-groups/${groupId}/channel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId, dryRun: true })
        }
      );
      const result = await response.json();

      if (!response.ok) {
        setMessage({
          type: "error",
          text: result.error || "Unable to verify the assignment preview."
        });
        return;
      }

      setVerifiedPreview({ ...result, channelId });
    } catch {
      setMessage({
        type: "error",
        text: "A connection error occurred while verifying the preview."
      });
    } finally {
      setPreviewing(false);
    }
  }

  async function assignChannel() {
    if (
      !channelId ||
      verifiedPreview?.channelId !== channelId ||
      verifiedPreview.changedZoneCount === 0
    ) {
      return;
    }

    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      const response = await fetch(
        `/api/admin/location-groups/${groupId}/channel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId })
        }
      );
      const result = await response.json();

      if (!response.ok) {
        setMessage({
          type: "error",
          text: result.error || "Unable to assign the channel."
        });
        return;
      }

      setMessage({
        type: "success",
        text: `${result.channel.name} assigned to ${result.changedZoneCount} zone${result.changedZoneCount === 1 ? "" : "s"}.`
      });
      setVerifiedPreview(null);
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

  if (preview.zoneCount === 0) {
    return (
      <p style={styles.muted}>
        Add locations with audio zones to this group before assigning a channel.
      </p>
    );
  }

  if (channels.length === 0) {
    return (
      <p style={styles.muted}>
        This organisation has no available channels. Create a channel first.
      </p>
    );
  }

  return (
    <div style={styles.container}>
      <label style={styles.label}>
        Channel to assign
        <select
          value={channelId}
          onChange={(event) => {
            setChannelId(event.target.value);
            setVerifiedPreview(null);
            setMessage({ type: "", text: "" });
          }}
          style={styles.select}
        >
          <option value="">Select a channel</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.name}
              {channel.station
                ? channel.streamConfigured
                  ? " — stream configured"
                  : " — stream needs setup"
                : " — no technical stream linked"}
            </option>
          ))}
        </select>
      </label>

      <div style={styles.summary} aria-live="polite">
        <strong>Impact preview:</strong>{" "}
        {channelId
          ? `${preview.changedZoneCount} zone${preview.changedZoneCount === 1 ? "" : "s"} will change; ${preview.unchangedZoneCount} already use ${selectedChannel?.name}.`
          : `Choose a channel to preview changes across ${preview.zoneCount} zone${preview.zoneCount === 1 ? "" : "s"}.`}
      </div>

      {verifiedPreview?.channelId === channelId ? (
        <div style={styles.verified} role="status">
          Server-verified dry run: {verifiedPreview.changedZoneCount} zone
          {verifiedPreview.changedZoneCount === 1 ? "" : "s"} will change and{" "}
          {verifiedPreview.unchangedZoneCount} will remain unchanged.
        </div>
      ) : null}

      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.header}>Location</th>
              <th style={styles.header}>Zone</th>
              <th style={styles.header}>Current channel</th>
              <th style={styles.header}>Result</th>
            </tr>
          </thead>
          <tbody>
            {preview.zones.map((zone) => (
              <tr key={zone.id} style={styles.row}>
                <td style={styles.cellStrong}>{zone.locationName}</td>
                <td style={styles.cell}>{zone.name}</td>
                <td style={styles.cell}>
                  {zone.currentChannelName || "Not assigned"}
                </td>
                <td style={styles.cell}>
                  {!channelId ? (
                    <span style={styles.muted}>Select a channel</span>
                  ) : zone.willChange ? (
                    <span style={styles.change}>Change to {selectedChannel?.name}</span>
                  ) : (
                    <span style={styles.unchanged}>No change</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={styles.actions}>
        <button
          type="button"
          onClick={verifyPreview}
          disabled={!channelId || previewing || saving}
          style={{
            ...styles.previewButton,
            opacity: !channelId || previewing || saving ? 0.55 : 1
          }}
        >
          {previewing ? "Verifying…" : "Verify dry run"}
        </button>
        <button
          type="button"
          onClick={assignChannel}
          disabled={
            verifiedPreview?.channelId !== channelId ||
            verifiedPreview?.changedZoneCount === 0 ||
            saving
          }
          style={{
            ...styles.button,
            opacity:
              verifiedPreview?.channelId !== channelId ||
              verifiedPreview?.changedZoneCount === 0 ||
              saving
                ? 0.55
                : 1
          }}
        >
          {saving
            ? "Assigning…"
            : `Confirm assignment to ${verifiedPreview?.changedZoneCount || 0} zone${verifiedPreview?.changedZoneCount === 1 ? "" : "s"}`}
        </button>
        {message.text ? (
          <span
            role="status"
            style={message.type === "success" ? styles.success : styles.error}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const styles = {
  container: { display: "grid", gap: 16 },
  label: { display: "grid", gap: 7, color: "#172033", fontWeight: 800 },
  select: {
    width: "100%",
    maxWidth: 560,
    border: "1px solid #94a3b8",
    borderRadius: 8,
    background: "#ffffff",
    color: "#111827",
    padding: "10px 12px",
    fontSize: 15
  },
  summary: {
    padding: 12,
    border: "1px solid #93c5fd",
    borderRadius: 8,
    background: "#eff6ff",
    color: "#1e3a8a",
    lineHeight: 1.5
  },
  verified: {
    padding: 12,
    border: "1px solid #86efac",
    borderRadius: 8,
    background: "#f0fdf4",
    color: "#166534",
    fontWeight: 800,
    lineHeight: 1.5
  },
  tableWrapper: {
    overflowX: "auto",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    background: "#ffffff"
  },
  table: { width: "100%", minWidth: 680, borderCollapse: "collapse" },
  header: {
    padding: 11,
    borderBottom: "2px solid #94a3b8",
    background: "#e2e8f0",
    color: "#172033",
    textAlign: "left",
    fontSize: 13
  },
  row: { borderBottom: "1px solid #e2e8f0" },
  cell: { padding: 11, color: "#334155", fontSize: 14 },
  cellStrong: { padding: 11, color: "#111827", fontSize: 14, fontWeight: 800 },
  change: { color: "#92400e", fontWeight: 800 },
  unchanged: { color: "#166534", fontWeight: 800 },
  muted: { color: "#64748b", fontWeight: 600 },
  actions: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  button: {
    border: 0,
    borderRadius: 8,
    background: "#f4b942",
    color: "#101827",
    padding: "11px 16px",
    fontWeight: 900,
    cursor: "pointer"
  },
  previewButton: {
    border: "1px solid #9a6400",
    borderRadius: 8,
    background: "#ffffff",
    color: "#7c4f00",
    padding: "10px 15px",
    fontWeight: 900,
    cursor: "pointer"
  },
  success: { color: "#166534", fontWeight: 800 },
  error: { color: "#b91c1c", fontWeight: 800 }
};

