"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/app/components/PageHeader";
import EmptyState from "@/app/components/EmptyState";
import ConfirmActionButton from "@/app/components/ConfirmActionButton";
import { confirmationCopy, interfaceMessages, safeInterfaceMessage } from "@/lib/interface-guidance.mjs";
import { groupSubscriberNotifications, subscriberNotificationDetails } from "@/lib/subscriber-notification-centre.mjs";
import styles from "./notifications.module.css";

const VIEWS = [
  { id: "ALL", label: "All" },
  { id: "UNREAD", label: "Unread" },
  { id: "CRITICAL", label: "Needs attention" }
];
const TYPE_OPTIONS = Object.entries(subscriberNotificationDetails).map(([value, details]) => ({ value, label: details.label }));

export default function NotificationsClient({ organisationName }) {
  const [centre, setCentre] = useState(null);
  const [preferences, setPreferences] = useState([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [view, setView] = useState("ALL");
  const [type, setType] = useState("ALL");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const query = new URLSearchParams({ view, type, take: "100" });
      const [notificationResponse, preferenceResponse] = await Promise.all([
        fetch(`/api/notifications?${query}`, { cache: "no-store" }),
        fetch("/api/notifications/preferences", { cache: "no-store" })
      ]);
      const [notificationBody, preferenceBody] = await Promise.all([notificationResponse.json(), preferenceResponse.json()]);
      if (!notificationResponse.ok) throw new Error(notificationBody.error || "Unable to load notifications.");
      if (!preferenceResponse.ok) throw new Error(preferenceBody.error || "Unable to load notification preferences.");
      setCentre(notificationBody);
      setPreferences(preferenceBody.preferences || []);
      setEmailConfigured(preferenceBody.emailConfigured === true);
    } catch (loadError) {
      setError(safeInterfaceMessage(loadError?.message, "Unable to load notifications."));
    }
  }, [type, view]);

  useEffect(() => { load(); }, [load]);
  const groups = useMemo(() => groupSubscriberNotifications(centre?.deliveries || []), [centre]);

  async function updateDelivery(deliveryId, action) {
    setBusy(`${deliveryId}:${action}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/notifications/${deliveryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update the notification.");
      setNotice(action === "READ" ? "Notification marked as read." : "Notification dismissed. Its operational record is retained.");
      await load();
    } catch (actionError) {
      setError(safeInterfaceMessage(actionError?.message, "Unable to update the notification."));
    } finally {
      setBusy("");
    }
  }

  async function bulkUpdate(action) {
    setBusy(`bulk:${action}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update the notification list.");
      setNotice(body.updated === 1 ? "1 notification updated." : `${body.updated} notifications updated.`);
      await load();
    } catch (actionError) {
      setError(safeInterfaceMessage(actionError?.message, "Unable to update the notification list."));
    } finally {
      setBusy("");
    }
  }

  async function updatePreference(notificationType, channel, enabled) {
    setBusy(`preference:${channel}:${notificationType}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: notificationType, channel, enabled })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update the notification preference.");
      setPreferences((current) => current.map((item) => item.type === notificationType && item.channel === channel ? { ...item, enabled } : item));
      setNotice("Notification preference saved.");
    } catch (preferenceError) {
      setError(safeInterfaceMessage(preferenceError?.message, "Unable to update the notification preference."));
    } finally {
      setBusy("");
    }
  }

  const summary = centre?.summary || {};
  return <main className={styles.page} id="main-content">
    <PageHeader eyebrow="Your service updates" title="Notification centre" description={`${organisationName} · understand what changed, what needs attention and where to continue.`} backHref="/dashboard" backLabel="Client dashboard" tone="dark">
      <button type="button" onClick={load} className={styles.outlineButton} disabled={Boolean(busy)}>Refresh updates</button>
    </PageHeader>

    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}

    <section className={styles.summaryGrid} aria-label="Notification summary">
      <SummaryCard label="Unread" value={summary.unread} tone="gold" />
      <SummaryCard label="Needs attention" value={summary.critical} tone="red" />
      <SummaryCard label="Warnings" value={summary.warning} tone="amber" />
      <SummaryCard label="Active updates" value={summary.total} tone="blue" />
    </section>

    <section className={styles.workspace}>
      <div className={styles.inboxCard}>
        <div className={styles.toolbar}>
          <div className={styles.tabs} role="group" aria-label="Notification view">
            {VIEWS.map((item) => <button key={item.id} type="button" className={`${styles.tab} ${view === item.id ? styles.activeTab : ""}`} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}{item.id === "UNREAD" && summary.unread ? <span>{summary.unread}</span> : null}</button>)}
          </div>
          <label className={styles.filterLabel}>Update type
            <select className={styles.select} value={type} onChange={(event) => setType(event.target.value)}>
              <option value="ALL">All service areas</option>
              {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.bulkActions}>
          <button type="button" className={styles.smallButton} disabled={Boolean(busy) || !summary.unread} onClick={() => bulkUpdate("MARK_ALL_READ")}>Mark all as read</button>
          <ConfirmActionButton className={styles.smallButton} disabled={Boolean(busy) || summary.total <= summary.unread} title="Dismiss all read notifications?" message="Read notifications will leave this active list. Their operational records will not be deleted." confirmLabel="Dismiss read notifications" cancelLabel="Keep notifications" onConfirm={() => bulkUpdate("DISMISS_READ")}>Dismiss read</ConfirmActionButton>
        </div>

        {!centre ? <p className={styles.loading} role="status">Loading your updates…</p> : groups.length === 0 ? <EmptyState compact tone="dark" title={interfaceMessages.notifications.emptyTitle} description={type === "ALL" ? interfaceMessages.notifications.emptyDescription : "No active updates match this service-area filter."} /> : groups.map((group) => (
          <section key={group.id} className={styles.group} aria-labelledby={`group-${group.id}`}>
            <h2 id={`group-${group.id}`} className={styles.groupTitle}>{group.label}</h2>
            <div className={styles.notificationList}>{group.items.map((delivery) => (
              <article key={delivery.id} className={`${styles.notification} ${!delivery.readAt ? styles.unread : ""}`}>
                <div className={styles.notificationTop}>
                  <div className={styles.labelRow}><span className={styles.category}>{delivery.category}</span><span className={`${styles.severity} ${styles[delivery.severity.toLowerCase()]}`}>{severityLabel(delivery.severity)}</span></div>
                  <time className={styles.time} dateTime={new Date(delivery.occurredAt).toISOString()}>{formatDate(delivery.occurredAt)}</time>
                </div>
                <h3 className={styles.notificationTitle}>{delivery.title}</h3>
                <p className={styles.message}>{delivery.message}</p>
                <div className={styles.actions}>
                  <Link className={styles.primaryLink} href={delivery.actionHref}>{delivery.actionLabel} →</Link>
                  {!delivery.readAt ? <button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => updateDelivery(delivery.id, "READ")}>{busy === `${delivery.id}:READ` ? "Saving…" : "Mark read"}</button> : <span className={styles.readState}>Read</span>}
                  <ConfirmActionButton disabled={Boolean(busy)} onConfirm={() => updateDelivery(delivery.id, "DISMISS")} className={styles.textButton} {...confirmationCopy("DISMISS_NOTIFICATION", delivery.title)}>{busy === `${delivery.id}:DISMISS` ? "Saving…" : "Dismiss"}</ConfirmActionButton>
                </div>
              </article>
            ))}</div>
          </section>
        ))}
      </div>

      <aside className={styles.preferencesCard} aria-labelledby="preference-title">
        <div className={styles.stickyPanel}>
          <p className={styles.panelEyebrow}>PERSONAL SETTINGS</p>
          <h2 id="preference-title" className={styles.panelTitle}>How you receive updates</h2>
          <p className={styles.panelCopy}>These choices apply only to your account in {organisationName}.</p>
          <PreferenceGroup title="In the portal" description="Choose what appears in this notification centre." channel="IN_APP" preferences={preferences} busy={busy} updatePreference={updatePreference} />
          <PreferenceGroup title="By email" description={emailConfigured ? "Optional summaries return you to the secure portal." : "Email is unavailable until Ruvanas configures an approved provider."} channel="EMAIL" preferences={preferences} busy={busy} updatePreference={updatePreference} disabled={!emailConfigured} />
          <p className={styles.safety}>Essential security or legal notices may still be shown. Signed integration delivery remains controlled by Ruvanas administration.</p>
        </div>
      </aside>
    </section>
  </main>;
}

function SummaryCard({ label, value, tone }) {
  return <article className={`${styles.summaryCard} ${styles[`summary${tone}`]}`}><span>{label}</span><strong>{value ?? "—"}</strong></article>;
}

function PreferenceGroup({ title, description, channel, preferences, busy, updatePreference, disabled = false }) {
  return <details className={styles.preferenceGroup} open={channel === "IN_APP"}>
    <summary>{title}</summary>
    <p>{description}</p>
    <div className={styles.preferenceList}>{preferences.filter((item) => item.channel === channel).map((preference) => (
      <label key={`${channel}:${preference.type}`} className={`${styles.preference} ${disabled ? styles.disabledPreference : ""}`}>
        <span>{subscriberNotificationDetails[preference.type]?.label || preference.type}</span>
        <input type="checkbox" checked={preference.enabled} disabled={disabled || busy === `preference:${channel}:${preference.type}`} onChange={(event) => updatePreference(preference.type, channel, event.target.checked)} />
      </label>
    ))}</div>
  </details>;
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(value)) : "Time unavailable";
}

function severityLabel(value) {
  if (value === "CRITICAL") return "Needs attention";
  if (value === "WARNING") return "Warning";
  return "Information";
}
