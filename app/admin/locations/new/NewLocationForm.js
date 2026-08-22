"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const defaultForm = {
  organisationId: "",
  brandId: "",
  name: "",
  slug: "",
  timezone: "Europe/Malta",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "MT",
  firstZoneName: "Main Store"
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

export default function NewLocationForm({ organisations }) {
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

  function updateField(event) {
    const { name, value } = event.target;

    setForm((current) => {
      const next = {
        ...current,
        [name]: value
      };

      if (name === "organisationId") {
        next.brandId = "";
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
        text: "Please enter a location name."
      });
      return;
    }

    if (!form.slug.trim()) {
      setMessage({
        type: "error",
        text: "Please enter a location slug."
      });
      return;
    }

    if (!form.firstZoneName.trim()) {
      setMessage({
        type: "error",
        text: "Please enter the first audio-zone name."
      });
      return;
    }

    setSaving(true);
    setMessage({
      type: "",
      text: ""
    });

    try {
      const response = await fetch("/api/admin/locations", {
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
          text: data.error || "Unable to create the location."
        });
        return;
      }

      setMessage({
        type: "success",
        text: "Retail location created successfully."
      });

      router.push("/admin/locations");
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
        <h2 style={styles.sectionTitle}>Location details</h2>

        <label style={styles.label}>
          Location name
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={updateField}
            placeholder="Mosta Store"
            style={styles.input}
            required
          />
        </label>

        <label style={styles.label}>
          Location slug
          <input
            type="text"
            name="slug"
            value={form.slug}
            onChange={updateField}
            placeholder="mosta-store"
            style={styles.input}
            required
          />
        </label>

        <label style={styles.label}>
          Timezone
          <input
            type="text"
            name="timezone"
            value={form.timezone}
            onChange={updateField}
            placeholder="Europe/Malta"
            style={styles.input}
            required
          />
        </label>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Address (optional)</h2>

        <label style={styles.label}>
          Address line 1
          <input
            type="text"
            name="addressLine1"
            value={form.addressLine1}
            onChange={updateField}
            placeholder="12 Main Street"
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Address line 2
          <input
            type="text"
            name="addressLine2"
            value={form.addressLine2}
            onChange={updateField}
            placeholder="Ground floor"
            style={styles.input}
          />
        </label>

        <div style={styles.twoColumns}>
          <label style={styles.label}>
            City
            <input
              type="text"
              name="city"
              value={form.city}
              onChange={updateField}
              placeholder="Mosta"
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Region
            <input
              type="text"
              name="region"
              value={form.region}
              onChange={updateField}
              placeholder="Northern Region"
              style={styles.input}
            />
          </label>
        </div>

        <div style={styles.twoColumns}>
          <label style={styles.label}>
            Postal code
            <input
              type="text"
              name="postalCode"
              value={form.postalCode}
              onChange={updateField}
              placeholder="MST 1234"
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Country code
            <input
              type="text"
              name="countryCode"
              value={form.countryCode}
              onChange={updateField}
              placeholder="MT"
              maxLength={2}
              style={styles.input}
            />
          </label>
        </div>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>First audio zone</h2>

        <p style={styles.helpText}>
          Every retail location needs at least one audio area. You can add more
          zones later, such as Café, Sales Floor, Reception, or Staff Area.
        </p>

        <label style={styles.label}>
          Zone name
          <input
            type="text"
            name="firstZoneName"
            value={form.firstZoneName}
            onChange={updateField}
            placeholder="Main Store"
            style={styles.input}
            required
          />
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
        {saving ? "Creating location…" : "Create retail location"}
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
  twoColumns: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 16
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
