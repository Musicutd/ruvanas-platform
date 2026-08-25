"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function NewPlayerForm({ organisations }) {
  const router = useRouter();
  const [form, setForm] = useState({
    organisationId: organisations[0]?.id || "",
    zoneId: "",
    name: ""
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [enrolment, setEnrolment] = useState(null);

  const selectedOrganisation = useMemo(
    () => organisations.find((item) => item.id === form.organisationId),
    [form.organisationId, organisations]
  );

  const zones = selectedOrganisation?.locations.flatMap((location) =>
    location.zones.map((zone) => ({
      ...zone,
      locationName: location.name
    }))
  ) || [];

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === "organisationId" ? { zoneId: "" } : {})
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setEnrolment(null);

    try {
      const response = await fetch("/api/admin/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Unable to create the player.");
        return;
      }

      setEnrolment(data.player);
      setForm((current) => ({ ...current, name: "" }));
      router.refresh();
    } catch {
      setMessage("A connection error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={styles.card}>
      <h2 style={styles.title}>Enrol a web player</h2>
      <p style={styles.copy}>
        Bind a persistent browser player to one audio zone. The one-time code
        expires after 24 hours and is shown only here.
      </p>

      <form onSubmit={submit} style={styles.form}>
        <label style={styles.label}>
          Organisation
          <select name="organisationId" value={form.organisationId} onChange={update} style={styles.input}>
            <option value="">Select an organisation</option>
            {organisations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        <label style={styles.label}>
          Location and zone
          <select name="zoneId" value={form.zoneId} onChange={update} style={styles.input}>
            <option value="">Select a zone</option>
            {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.locationName} - {zone.name}</option>)}
          </select>
        </label>

        <label style={styles.label}>
          Player name
          <input name="name" value={form.name} onChange={update} style={styles.input} placeholder="Mosta sales-floor player" />
        </label>

        <button disabled={saving || !form.organisationId || !form.zoneId || !form.name.trim()} style={styles.button}>
          {saving ? "Creating..." : "Create enrolment"}
        </button>
      </form>

      {message ? <p style={styles.error}>{message}</p> : null}

      {enrolment ? (
        <div style={styles.success}>
          <strong>One-time enrolment code</strong>
          <code style={styles.code}>{enrolment.enrolmentCode}</code>
          <span>Open <b>/player</b> on the playback device and paste this code.</span>
        </div>
      ) : null}
    </section>
  );
}

const styles = {
  card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 22, background: "#fff" },
  title: { margin: 0, color: "#0f172a", fontSize: 22 },
  copy: { color: "#475569", lineHeight: 1.55 },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, alignItems: "end" },
  label: { display: "grid", gap: 7, color: "#334155", fontWeight: 800, fontSize: 14 },
  input: { minHeight: 42, border: "1px solid #94a3b8", borderRadius: 7, padding: "9px 10px", background: "#fff", color: "#0f172a" },
  button: { minHeight: 42, border: 0, borderRadius: 7, padding: "10px 16px", background: "#0f172a", color: "#fff", fontWeight: 800, cursor: "pointer" },
  error: { color: "#b91c1c", fontWeight: 700 },
  success: { marginTop: 18, display: "grid", gap: 10, border: "1px solid #86efac", background: "#f0fdf4", padding: 16, borderRadius: 9, color: "#14532d" },
  code: { display: "block", overflowWrap: "anywhere", background: "#dcfce7", padding: 10, borderRadius: 6, fontSize: 14 }
};

