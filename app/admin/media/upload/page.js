"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const promoMediaTypes = [
  { value: "COMMERCIAL", label: "Commercial" },
  { value: "JINGLE", label: "Jingle" },
  { value: "ANNOUNCEMENT", label: "Announcement" },
  { value: "VOICEOVER", label: "Voiceover" }
];

export default function AdminPromoUploadPage() {
  const router = useRouter();

  const [organisations, setOrganisations] = useState([]);
  const [organisationId, setOrganisationId] = useState("");
  const [loadingOrganisations, setLoadingOrganisations] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadOrganisations() {
      try {
        const response = await fetch("/api/admin/organisations");

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));

          throw new Error(
            data.error || "Unable to load organisations for this upload."
          );
        }

        const data = await response.json();
        const items = Array.isArray(data.organisations)
          ? data.organisations
          : [];

        if (!cancelled) {
          setOrganisations(items);

          if (items.length === 1) {
            setOrganisationId(items[0].id);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load organisations for this upload."
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingOrganisations(false);
        }
      }
    }

    loadOrganisations();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");

    if (!organisationId) {
      setError("Choose the organisation that owns this promotional audio.");
      return;
    }

    if (!file || !(file instanceof File) || file.size === 0) {
      setError("Choose an audio file before uploading.");
      return;
    }

    formData.set("organisationId", organisationId);
    setUploading(true);

    try {
      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "The promotional audio upload failed.");
      }

      setSuccess(`"${data.name}" uploaded successfully.`);
      form.reset();

      window.setTimeout(() => {
        router.push("/admin/media");
        router.refresh();
      }, 1000);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "The promotional audio upload failed."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Organisation promo library</p>
          <h1 style={styles.title}>Upload promotional audio</h1>
          <p style={styles.description}>
            Upload an organisation-owned commercial, jingle, announcement, or
            voiceover. Music catalogue uploads are managed separately by
            Ruvanas.
          </p>
        </div>

        <Link href="/admin/media" style={styles.backLink}>
          Back to Promo Library
        </Link>
      </div>

      <section style={styles.card}>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label htmlFor="organisationId" style={styles.label}>
              Organisation
            </label>

            <select
              id="organisationId"
              name="organisationId"
              value={organisationId}
              onChange={(event) => setOrganisationId(event.target.value)}
              disabled={loadingOrganisations || uploading}
              required
              style={styles.input}
            >
              <option value="">
                {loadingOrganisations
                  ? "Loading organisations…"
                  : "Choose an organisation"}
              </option>

              {organisations.map((organisation) => (
                <option key={organisation.id} value={organisation.id}>
                  {organisation.name}
                </option>
              ))}
            </select>

            <p style={styles.hint}>
              This promotional file will be private to the selected
              organisation and will count toward its storage allocation.
            </p>
          </div>

          <div style={styles.field}>
            <label htmlFor="file" style={styles.label}>
              Audio file
            </label>

            <input
              id="file"
              name="file"
              type="file"
              accept=".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
              required
              disabled={uploading}
              style={styles.input}
            />

            <p style={styles.hint}>
              Supported formats: MP3, WAV, OGG, and M4A. Maximum file size: 50
              MB.
            </p>
          </div>

          <div style={styles.field}>
            <label htmlFor="name" style={styles.label}>
              Display name
            </label>

            <input
              id="name"
              name="name"
              type="text"
              maxLength="200"
              placeholder="Example: Summer sale announcement"
              required
              disabled={uploading}
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label htmlFor="mediaType" style={styles.label}>
              Promotional audio type
            </label>

            <select
              id="mediaType"
              name="mediaType"
              defaultValue="COMMERCIAL"
              disabled={uploading}
              style={styles.input}
            >
              {promoMediaTypes.map((mediaType) => (
                <option key={mediaType.value} value={mediaType.value}>
                  {mediaType.label}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.field}>
            <label htmlFor="durationSeconds" style={styles.label}>
              Duration in seconds{" "}
              <span style={styles.optional}>(optional)</span>
            </label>

            <input
              id="durationSeconds"
              name="durationSeconds"
              type="number"
              min="1"
              step="1"
              placeholder="Example: 30"
              disabled={uploading}
              style={styles.input}
            />
          </div>

          {error ? <div style={styles.error}>{error}</div> : null}

          {success ? <div style={styles.success}>{success}</div> : null}

          <div style={styles.actions}>
            <Link href="/admin/media" style={styles.cancelButton}>
              Cancel
            </Link>

            <button
              type="submit"
              disabled={loadingOrganisations || uploading}
              style={{
                ...styles.submitButton,
                ...(loadingOrganisations || uploading
                  ? styles.submitButtonDisabled
                  : {})
              }}
            >
              {uploading ? "Uploading…" : "Upload promotional audio"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

const styles = {
  page: {
    maxWidth: 820,
    margin: "0 auto",
    padding: "40px 16px 64px",
    color: "#172033"
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 28
  },
  eyebrow: {
    margin: "0 0 8px",
    color: "#9a6400",
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  title: {
    margin: 0,
    color: "#111827",
    fontSize: 32,
    fontWeight: 900
  },
  description: {
    maxWidth: 620,
    margin: "10px 0 0",
    color: "#475569",
    fontSize: 15,
    lineHeight: 1.55
  },
  backLink: {
    color: "#7c4a03",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "underline"
  },
  card: {
    padding: 24,
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#f8fafc",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.08)"
  },
  form: {
    display: "grid",
    gap: 20
  },
  field: {
    display: "grid",
    gap: 8
  },
  label: {
    color: "#172033",
    fontSize: 14,
    fontWeight: 900
  },
  optional: {
    color: "#64748b",
    fontWeight: 600
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #94a3b8",
    borderRadius: 7,
    background: "#ffffff",
    color: "#172033",
    padding: "11px 12px",
    fontSize: 15
  },
  hint: {
    margin: 0,
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.45
  },
  error: {
    border: "1px solid #fca5a5",
    borderRadius: 7,
    background: "#fef2f2",
    color: "#991b1b",
    padding: "12px 13px",
    fontSize: 14,
    fontWeight: 700
  },
  success: {
    border: "1px solid #86efac",
    borderRadius: 7,
    background: "#f0fdf4",
    color: "#166534",
    padding: "12px 13px",
    fontSize: 14,
    fontWeight: 700
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 4
  },
  cancelButton: {
    border: "1px solid #94a3b8",
    borderRadius: 7,
    background: "#ffffff",
    color: "#334155",
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "none"
  },
  submitButton: {
    border: "none",
    borderRadius: 7,
    background: "#f4b942",
    color: "#172033",
    padding: "11px 16px",
    fontSize: 14,
    fontWeight: 900,
    cursor: "pointer"
  },
  submitButtonDisabled: {
    cursor: "not-allowed",
    opacity: 0.65
  }
};
