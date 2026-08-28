"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function monthPeriod() {
  const now = new Date();
  return {
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  };
}

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

export default function BillingControls({ organisation }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const contract = organisation.subscription?.billingContract;
  const account = organisation.billingAccount;
  const [form, setForm] = useState({
    provider: account?.provider || "MANUAL",
    externalCustomerId: account?.externalCustomerId || "",
    externalSubscriptionId: contract?.externalSubscriptionId || "",
    providerStatus: contract?.providerStatus || "",
    subscriptionStatus: organisation.subscription?.status || "TRIAL",
    graceEndsAt: localDateTime(contract?.graceEndsAt)
  });

  async function request(url, options) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, options);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The request failed.");
      setMessage("Saved successfully.");
      router.refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  function saveBilling(event) {
    event.preventDefault();
    return request(`/api/admin/billing/organisations/${organisation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        externalCustomerId: form.externalCustomerId || null,
        externalSubscriptionId: form.externalSubscriptionId || null,
        providerStatus: form.providerStatus || null,
        graceEndsAt: form.graceEndsAt
          ? new Date(form.graceEndsAt).toISOString()
          : null
      })
    });
  }

  function reconcile() {
    const { periodStart, periodEnd } = monthPeriod();
    return request("/api/admin/billing/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organisationId: organisation.id,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString()
      })
    });
  }

  return (
    <details style={styles.details}>
      <summary style={styles.summary}>Manage</summary>
      <form onSubmit={saveBilling} style={styles.form}>
        <label style={styles.label}>
          Billing provider
          <select
            value={form.provider}
            onChange={(event) => setForm({ ...form, provider: event.target.value })}
            style={styles.input}
          >
            <option value="MANUAL">Manual</option>
            <option value="GENERIC_HMAC">Connected provider</option>
          </select>
        </label>
        <label style={styles.label}>
          Customer reference
          <input
            value={form.externalCustomerId}
            onChange={(event) => setForm({ ...form, externalCustomerId: event.target.value })}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Subscription reference
          <input
            value={form.externalSubscriptionId}
            onChange={(event) => setForm({ ...form, externalSubscriptionId: event.target.value })}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Provider status
          <input
            value={form.providerStatus}
            onChange={(event) => setForm({ ...form, providerStatus: event.target.value })}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Ruvanas access status
          <select
            value={form.subscriptionStatus}
            onChange={(event) => setForm({ ...form, subscriptionStatus: event.target.value })}
            style={styles.input}
          >
            {[
              "TRIAL",
              "ACTIVE",
              "PAST_DUE",
              "SUSPENDED",
              "CANCELLED"
            ].map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        <label style={styles.label}>
          Grace period ends
          <input
            type="datetime-local"
            value={form.graceEndsAt}
            onChange={(event) => setForm({ ...form, graceEndsAt: event.target.value })}
            style={styles.input}
          />
        </label>
        <div style={styles.actions}>
          <button type="submit" disabled={busy} style={styles.primaryButton}>
            Save billing
          </button>
          <button type="button" disabled={busy} onClick={reconcile} style={styles.secondaryButton}>
            Check this month&apos;s usage
          </button>
        </div>
        {message ? <p style={styles.message}>{message}</p> : null}
      </form>
    </details>
  );
}

const styles = {
  details: { minWidth: 190 },
  summary: { color: "#7c5200", fontWeight: 900, cursor: "pointer" },
  form: { display: "grid", gap: 10, marginTop: 12, padding: 14, border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" },
  label: { display: "grid", gap: 5, color: "#334155", fontSize: 12, fontWeight: 800 },
  input: { minWidth: 220, padding: "8px 9px", border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", color: "#172033" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  primaryButton: { border: 0, borderRadius: 6, padding: "9px 11px", background: "#f4b942", color: "#172033", fontWeight: 900, cursor: "pointer" },
  secondaryButton: { border: "1px solid #64748b", borderRadius: 6, padding: "9px 11px", background: "#fff", color: "#172033", fontWeight: 800, cursor: "pointer" },
  message: { margin: 0, color: "#334155", fontSize: 12, fontWeight: 700 }
};

