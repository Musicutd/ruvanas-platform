"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function CatalogueUploadForm({ genres }) {
  const router = useRouter();
  const formRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event) {
    event.preventDefault();
    setUploading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/admin/catalogue/upload", {
        method: "POST",
        body: new FormData(event.currentTarget)
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "The catalogue track could not be uploaded.");
      }

      setSuccess(
        `${body.track.artist} — ${body.track.title} was uploaded as ${body.track.status.toLowerCase()}.`
      );
      formRef.current?.reset();
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The catalogue track could not be uploaded."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} style={styles.form}>
      <div style={styles.grid}>
        <label style={styles.label}>
          Music file
          <input
            name="file"
            type="file"
            accept=".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
            required
            disabled={uploading}
            style={styles.input}
          />
          <span style={styles.hint}>MP3, WAV, OGG, or M4A; maximum 50 MB.</span>
        </label>

        <label style={styles.label}>
          Track title
          <input name="title" required maxLength={200} disabled={uploading} style={styles.input} />
        </label>

        <label style={styles.label}>
          Artist
          <input name="artist" required maxLength={200} disabled={uploading} style={styles.input} />
        </label>

        <label style={styles.label}>
          Album (optional)
          <input name="album" maxLength={200} disabled={uploading} style={styles.input} />
        </label>

        <label style={styles.label}>
          Release year (optional)
          <input name="releaseYear" type="number" min={1877} max={2200} disabled={uploading} style={styles.input} />
        </label>

        <label style={styles.label}>
          Duration in seconds (optional)
          <input name="durationSeconds" type="number" min={1} max={86400} disabled={uploading} style={styles.input} />
        </label>

        <label style={styles.label}>
          Rights holder or licensor
          <input name="rightsHolder" required maxLength={200} disabled={uploading} style={styles.input} />
        </label>

        <label style={styles.label}>
          Licence or rights reference
          <input name="rightsReference" required maxLength={500} disabled={uploading} style={styles.input} placeholder="Contract, licence, invoice, or internal reference" />
        </label>

        <label style={styles.label}>
          Permitted territories
          <input name="permittedTerritories" required maxLength={500} disabled={uploading} style={styles.input} placeholder="For example: Worldwide or Malta and EU" />
        </label>

        <label style={styles.label}>
          Licence expiry (optional)
          <input name="licenceExpiresAt" type="date" disabled={uploading} style={styles.input} />
        </label>
      </div>

      {genres.length > 0 ? (
        <fieldset style={styles.fieldset} disabled={uploading}>
          <legend style={styles.legend}>Genres (up to 10)</legend>
          <div style={styles.checkboxGrid}>
            {genres.map((genre) => (
              <label key={genre.id} style={styles.checkLabel}>
                <input type="checkbox" name="genreIds" value={genre.id} />
                {genre.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div style={styles.confirmations}>
        <label style={styles.checkLabel}>
          <input type="checkbox" name="isExplicit" disabled={uploading} />
          This track contains explicit content
        </label>

        <label style={styles.checkLabelStrong}>
          <input type="checkbox" name="rightsConfirmed" required disabled={uploading} />
          I confirm that Ruvanas is authorised to store, distribute, and programme this recording in the stated territories.
        </label>

        <label style={styles.checkLabel}>
          <input type="checkbox" name="publishNow" disabled={uploading} />
          Mark this track ready for programming immediately
        </label>
        <p style={styles.hint}>
          Leave this unchecked to keep the track in Draft. Even a Ready track will not play until you add it to a Music Mode and publish a schedule.
        </p>
      </div>

      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
      {success ? <div role="status" style={styles.success}>{success}</div> : null}

      <button type="submit" disabled={uploading} style={styles.button}>
        {uploading ? "Uploading securely…" : "Upload catalogue track"}
      </button>
    </form>
  );
}

const styles = {
  form: { display: "grid", gap: 18 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 },
  label: { display: "grid", gap: 7, color: "#172033", fontSize: 14, fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#111827", font: "inherit" },
  hint: { margin: 0, color: "#64748b", fontSize: 12, fontWeight: 600, lineHeight: 1.45 },
  fieldset: { margin: 0, padding: 16, border: "1px solid #cbd5e1", borderRadius: 8 },
  legend: { padding: "0 7px", color: "#172033", fontSize: 14, fontWeight: 900 },
  checkboxGrid: { display: "flex", flexWrap: "wrap", gap: "10px 18px" },
  confirmations: { display: "grid", gap: 12, padding: 16, border: "1px solid #fbbf24", borderRadius: 8, background: "#fffbeb" },
  checkLabel: { display: "flex", alignItems: "flex-start", gap: 9, color: "#334155", fontSize: 14, fontWeight: 700, lineHeight: 1.45 },
  checkLabelStrong: { display: "flex", alignItems: "flex-start", gap: 9, color: "#78350f", fontSize: 14, fontWeight: 900, lineHeight: 1.45 },
  error: { padding: 12, border: "1px solid #fca5a5", borderRadius: 7, background: "#fef2f2", color: "#991b1b", fontWeight: 700 },
  success: { padding: 12, border: "1px solid #86efac", borderRadius: 7, background: "#f0fdf4", color: "#166534", fontWeight: 700 },
  button: { justifySelf: "start", border: 0, borderRadius: 7, background: "#f4b942", color: "#172033", padding: "12px 17px", fontWeight: 900, cursor: "pointer" }
};

