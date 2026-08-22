"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const defaultForm = {
  organisationId: "",
  brandId: "",
  stationId: "",
  name: "",
  slug: "",
  description: ""
};

function makeSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function NewChannelForm({ organisations }) {
  const router = useRouter();

  const [form, setForm] = useState({
    ...defaultForm,
    organisationId: organisations[0]?.id ?? ""
  });

  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState({
    type: "",
    text: ""
  });

  const selectedOrganisation = useMemo(() => {
    return organisations.find(
      (organisation) => organisation.id === form.organisationId
    );
  }, [form.organisationId, organisations]);

  const availableBrands = selectedOrganisation?.brands ?? [];
  const availableStations = selectedOrganisation?.stations ?? [];

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => {
      const next = {
        ...current,
        [name]: value
      };

      if (name === "organisationId") {
        next.brandId = "";
        next.stationId = "";
      }

      if (name === "name") {
        next.slug = makeSlug(value);
      }

      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.organisationId) {
      setMessage({
        type: "error",
        text: "Please select an organisation."
      });
      return;
    }

    if (!form.name.trim()) {
      setMessage({
        type: "error",
        text: "Please enter a channel name."
      });
      return;
    }

    if (!form.slug.trim()) {
      setMessage({
        type: "error",
        text: "Please enter a channel slug."
      });
      return;
    }

    setSaving(true);
    setMessage({
      type: "",
      text: ""
    });

    try {
      const response = await fetch("/api/admin/channels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage({
          type: "error",
          text: data.error || "Unable to create the Ruvanas channel."
        });
        return;
      }

      setMessage({
        type: "success",
        text: "Ruvanas channel created successfully."
      });

      router.push("/admin/channels");
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

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Organisation and brand</h2>

        <label style={styles.label}>
          Organisation
          <select
            name="organisationId"
            value={form.organisationId}
            onChange={updateField}
            style={styles.input}
            required
          >
            <option value="">Select an organisation</option>

            {organisations.map((organisation) => (
              <option key={organisation.id} value={organisation.id}>
                {organisation.name}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          Brand (optional)
          <select
            name="brandId"
            value={form.brandId}
            onChange={updateField}
            style={styles.input}
            disabled={!form.organisationId}
          >
            <option value="">No brand selected</option>

            {availableBrands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Channel details</h2>

        <label style={styles.label}>
          Channel name
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={updateField}
            placeholder="Fashion K Main Radio"
            style={styles.input}
            required
          />
        </label>

        <label style={styles.label}>
          Channel slug
          <input
            type="text"
            name="slug"
            value={form.slug}
            onChange={updateField}
            placeholder="fashion-k-main-radio"
            style={styles.input}
            required
          />
        </label>

        <label style={styles.label}>
          Description (optional)
          <textarea
            name="description"
            value={form.description}
            onChange={updateField}
            placeholder="Primary in-store music and promotions channel."
            rows={4}
            style={{
              ...styles.input,
              resize: "vertical"
            }}
          />
        </label>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Technical station link</h2>

        <p style={styles.helpText}>
          You can optionally link this friendly channel to an existing technical
          station. Retail users see the channel name, not server URLs or Centova
          credentials.
        </p>

        <label style={styles.label}>
          Technical station (optional)
          <select
            name="stationId"
            value={form.stationId}
            onChange={updateField}
            style={styles.input}
            disabled={!form.organisationId}
          >
            <option value="">Link later — no station selected</option>

            {availableStations.map((station) => {
              const configured = Boolean(station.streamConfig?.streamUrl);

              return (
                <option key={station.id} value={station.id}>
                  {station.name} — {station.status}
                  {configured ? " — stream configured" : " — stream needs setup"}
                </option>
              );
            })}
          </select>
        </label>
      </section>

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

      <button type="submit" disabled={saving} style={styles.button}>
        {saving ? "Creating channel…" : "Create Ruvanas channel"}
      </button>
    </form>
  );
}

const styles = {
  form: {
    display: "grid",
    gap: 24
  },
  section: {
    display: "grid",
    gap: 16,
    padding: 22,
    border: "1px solid #2b3a54",
    borderRadius: 12,
    background: "#182235"
  },
  sectionTitle: {
    margin: 0,
    color: "#f4b942",
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  label: {
    display: "grid",
    gap: 8,
    color: "#d8e0ec",
    fontSize: 14,
    fontWeight: 700
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #42526b",
    borderRadius: 8,
    background: "#0f1725",
    color: "#ffffff",
    padding: "12px 13px",
    fontSize: 15
  },
  helpText: {
    margin: 0,
    color: "#9fb3c8",
    fontSize: 14,
    lineHeight: 1.5
  },
  message: {
    margin: 0,
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 1.45
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
    justifySelf: "start",
    border: "none",
    borderRadius: 8,
    background: "#f4b942",
    color: "#101827",
    padding: "13px 18px",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer"
  }
};
