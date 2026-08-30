"use client";

import { useCallback, useEffect, useState } from "react";

const LABELS = {
  PLAYER_OFFLINE: "Player offline",
  STREAM_ERROR: "Stream error",
  CAMPAIGN_FAILURE: "Campaign failure",
  PRODUCTION_ORDER_UPDATE: "Production order update",
  BILLING_STATE: "Billing state",
  SCHOOL_REVIEW_REQUEST: "School review request",
  CONSENT_EXPIRY: "Consent expiry"
};

export default function NotificationsClient({ organisationName }) {
  const [notifications, setNotifications] = useState(null);
  const [preferences, setPreferences] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [notificationResponse, preferenceResponse] = await Promise.all([
        fetch("/api/notifications", { cache: "no-store" }),
        fetch("/api/notifications/preferences", { cache: "no-store" })
      ]);
      const [notificationBody, preferenceBody] = await Promise.all([
        notificationResponse.json(),
        preferenceResponse.json()
      ]);
      if (!notificationResponse.ok) throw new Error(notificationBody.error || "Unable to load notifications.");
      if (!preferenceResponse.ok) throw new Error(preferenceBody.error || "Unable to load notification preferences.");
      setNotifications(notificationBody);
      setPreferences(preferenceBody.preferences || []);
    } catch (loadError) {
      setError(loadError.message || "Unable to load notifications.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateDelivery(deliveryId, action) {
    setBusy(`${deliveryId}:${action}`);
    setError("");
    try {
      const response = await fetch(`/api/notifications/${deliveryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update the notification.");
      await load();
    } catch (actionError) {
      setError(actionError.message || "Unable to update the notification.");
    } finally {
      setBusy("");
    }
  }

  async function updatePreference(type, enabled) {
    setBusy(`preference:${type}`);
    setError("");
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, enabled })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update the notification preference.");
      setPreferences((current) => current.map((item) => item.type === type ? { ...item, enabled } : item));
    } catch (preferenceError) {
      setError(preferenceError.message || "Unable to update the notification preference.");
    } finally {
      setBusy("");
    }
  }

  return <main style={styles.page}>
    <header style={styles.header}>
      <div>
        <a href="/dashboard" style={styles.back}>← Client dashboard</a>
        <p style={styles.eyebrow}>STAGE 11D · IN-APP NOTIFICATIONS</p>
        <h1 style={styles.title}>Operational notifications</h1>
        <p style={styles.subtitle}>{organisationName} · clear, tenant-safe alerts for playback, streams, campaigns, billing, production, and school review operations.</p>
      </div>
      <button type="button" onClick={load} style={styles.secondary}>Refresh</button>
    </header>

    {error ? <p role="alert" style={styles.error}>{error}</p> : null}
    <section style={styles.summary}>
      <div><span style={styles.summaryLabel}>Unread</span><strong style={styles.summaryValue}>{notifications?.unread ?? "—"}</strong></div>
      <p style={styles.summaryText}>Email and webhook delivery remain disabled until their security and consent controls are implemented.</p>
    </section>

    <section style={styles.grid}>
      <article style={styles.card}>
        <h2 style={styles.sectionTitle}>Notification centre</h2>
        {!notifications ? <p style={styles.muted}>Loading notifications…</p> : notifications.deliveries.length === 0 ? <p style={styles.good}>No active notifications.</p> : notifications.deliveries.map((delivery) => (
          <div key={delivery.id} style={{ ...styles.notification, ...(!delivery.readAt ? styles.unread : {}) }}>
            <div style={styles.notificationHeader}>
              <strong>{delivery.notificationEvent.title}</strong>
              <span style={{ ...styles.badge, ...severityStyle(delivery.notificationEvent.severity) }}>{delivery.notificationEvent.severity}</span>
            </div>
            <p style={styles.message}>{delivery.notificationEvent.message}</p>
            <p style={styles.meta}>{LABELS[delivery.notificationEvent.type] || delivery.notificationEvent.type} · {formatDate(delivery.notificationEvent.occurredAt)}</p>
            <div style={styles.actions}>
              {!delivery.readAt ? <button type="button" disabled={Boolean(busy)} onClick={() => updateDelivery(delivery.id, "READ")} style={styles.secondary}>{busy === `${delivery.id}:READ` ? "Saving…" : "Mark read"}</button> : null}
              <button type="button" disabled={Boolean(busy)} onClick={() => updateDelivery(delivery.id, "DISMISS")} style={styles.dismiss}>{busy === `${delivery.id}:DISMISS` ? "Saving…" : "Dismiss"}</button>
            </div>
          </div>
        ))}
      </article>

      <aside style={styles.card}>
        <h2 style={styles.sectionTitle}>In-app preferences</h2>
        <p style={styles.muted}>Choose which operational events appear here. Critical platform safeguards may still be shown where legally or operationally required.</p>
        <div style={styles.preferenceList}>{preferences.map((preference) => (
          <label key={preference.type} style={styles.preference}>
            <span>{LABELS[preference.type] || preference.type}</span>
            <input type="checkbox" checked={preference.enabled} disabled={busy === `preference:${preference.type}`} onChange={(event) => updatePreference(preference.type, event.target.checked)} />
          </label>
        ))}</div>
      </aside>
    </section>
  </main>;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function severityStyle(severity) {
  if (severity === "CRITICAL") return { background: "#fee2e2", color: "#991b1b" };
  if (severity === "WARNING") return { background: "#fef3c7", color: "#92400e" };
  return { background: "#dbeafe", color: "#1e40af" };
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#fff", padding: "40px max(20px, calc((100% - 1160px) / 2)) 72px", fontFamily: "Arial, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", gap: 24, alignItems: "end", flexWrap: "wrap" },
  back: { color: "#b8c3d6", textDecoration: "none", fontWeight: 700 },
  eyebrow: { color: "#f4b942", letterSpacing: 1.5, fontSize: 12, fontWeight: 800, margin: "24px 0 10px" },
  title: { fontSize: "clamp(34px, 5vw, 52px)", margin: 0 },
  subtitle: { color: "#b8c3d6", lineHeight: 1.6, fontSize: 17, margin: "14px 0 0", maxWidth: 800 },
  summary: { marginTop: 22, display: "flex", gap: 24, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", padding: 18, border: "1px solid #6b5729", borderRadius: 12, background: "#2c2416" },
  summaryLabel: { display: "block", color: "#f8e3ae", fontSize: 12, fontWeight: 800, textTransform: "uppercase" },
  summaryValue: { display: "block", fontSize: 30, marginTop: 4 },
  summaryText: { color: "#f8e3ae", lineHeight: 1.5, maxWidth: 700, margin: 0 },
  grid: { display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(270px, 1fr)", gap: 18, marginTop: 20 },
  card: { border: "1px solid #2b3a54", borderRadius: 12, padding: 20, background: "#182235", alignSelf: "start" },
  sectionTitle: { margin: "0 0 16px", fontSize: 22 },
  notification: { padding: 16, border: "1px solid #2b3a54", borderRadius: 10, marginBottom: 12, background: "#141e2f" },
  unread: { borderColor: "#f4b942", boxShadow: "inset 4px 0 #f4b942" },
  notificationHeader: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" },
  badge: { padding: "4px 8px", borderRadius: 999, fontSize: 11, fontWeight: 900 },
  message: { color: "#dbe3ee", lineHeight: 1.55, margin: "10px 0 6px" },
  meta: { color: "#94a3b8", fontSize: 12, margin: 0 },
  actions: { display: "flex", gap: 8, marginTop: 12 },
  secondary: { border: "1px solid #f4b942", borderRadius: 7, padding: "9px 12px", background: "transparent", color: "#f4b942", fontWeight: 800, cursor: "pointer" },
  dismiss: { border: "1px solid #52627d", borderRadius: 7, padding: "9px 12px", background: "transparent", color: "#dbe3ee", fontWeight: 800, cursor: "pointer" },
  preferenceList: { display: "grid", gap: 4 },
  preference: { display: "flex", justifyContent: "space-between", gap: 16, padding: "11px 0", borderBottom: "1px solid #2b3a54", color: "#dbe3ee", fontWeight: 700 },
  muted: { color: "#aebbd0", lineHeight: 1.55 },
  good: { padding: 12, borderRadius: 8, background: "#163628", color: "#bbf7d0", fontWeight: 800 },
  error: { color: "#fecaca", background: "#3f1d27", border: "1px solid #9f4b4b", borderRadius: 8, padding: 12, margin: "16px 0 0" }
};
