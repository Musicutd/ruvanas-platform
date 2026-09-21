"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function CatalogueUploadForm({ genres }) {
  const router = useRouter();
  const formRef = useRef(null);
  const previewRequest = useRef(0);
  const [previewing, setPreviewing] = useState(false);
  const [metadataPreview, setMetadataPreview] = useState(null);
  const [metadataError, setMetadataError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function matchMetadata() {
    const form = formRef.current;
    const audio = form?.elements.namedItem("file")?.files?.[0];
    const spreadsheet = form?.elements.namedItem("metadataSpreadsheet")?.files?.[0];
    const requestNumber = ++previewRequest.current;
    setMetadataPreview(null);
    setMetadataError("");
    if (!audio || !spreadsheet) return;
    if (spreadsheet.size > 10 * 1024 * 1024) {
      setMetadataError("The metadata spreadsheet must be 10 MB or smaller.");
      return;
    }
    setPreviewing(true);
    try {
      const data = new FormData();
      data.set("audioFileName", audio.name);
      data.set("spreadsheet", spreadsheet);
      const response = await fetch("/api/admin/catalogue/metadata-preview", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The spreadsheet could not be matched.");
      if (requestNumber !== previewRequest.current) return;
      for (const name of ["title", "artist", "album", "mixName", "bpm", "releaseYear", "durationSeconds"]) {
        form.elements.namedItem(name).value = body.metadata[name] ?? "";
      }
      form.elements.namedItem("isExplicit").checked = body.metadata.isExplicit;
      for (const box of form.querySelectorAll('input[name="genreIds"]')) {
        box.checked = body.metadata.genreIds.includes(box.value);
      }
      setMetadataPreview(body.metadata);
    } catch (previewError) {
      if (requestNumber === previewRequest.current) setMetadataError(previewError instanceof Error ? previewError.message : "The spreadsheet could not be matched.");
    } finally {
      if (requestNumber === previewRequest.current) setPreviewing(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setUploading(true);
    setError("");
    setSuccess("");

    const spreadsheet = formRef.current?.elements.namedItem("metadataSpreadsheet")?.files?.[0];
    if (spreadsheet && !metadataPreview) {
      setUploading(false);
      setError("Match the metadata spreadsheet to the music file before uploading, or remove the spreadsheet.");
      return;
    }

    try {
      const uploadData = new FormData(event.currentTarget);
      uploadData.delete("metadataSpreadsheet");
      const response = await fetch("/api/admin/catalogue/upload", {
        method: "POST",
        body: uploadData
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || "The catalogue track could not be uploaded.");
      }

      setSuccess(
        `${body.track.artist} — ${body.track.title} was uploaded as ${body.track.status.toLowerCase()}.`
      );
      formRef.current?.reset();
      setMetadataPreview(null);
      setMetadataError("");
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
            onChange={matchMetadata}
            style={styles.input}
          />
          <span style={styles.hint}>MP3, WAV, OGG, or M4A; maximum 50 MB.</span>
        </label>

        <label style={styles.label}>
          Metadata spreadsheet (optional)
          <input
            name="metadataSpreadsheet"
            type="file"
            accept=".csv,.xlsx"
            disabled={uploading}
            onChange={matchMetadata}
            style={styles.input}
          />
          <span style={styles.hint}>CSV or XLSX, up to 10 MB. Choose the song file as well; we will match its row and fill the fields below.</span>
        </label>

        <input type="hidden" name="newGenres" value={JSON.stringify(metadataPreview?.newGenreNames || [])} />

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
          Mix (optional)
          <input name="mixName" maxLength={120} disabled={uploading} style={styles.input} placeholder="For example: Clean, Radio Edit or Remix" />
        </label>

        <label style={styles.label}>
          BPM (optional)
          <input name="bpm" type="number" min={20} max={300} disabled={uploading} style={styles.input} />
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

      {previewing ? <p role="status" style={styles.hint}>Matching the song to the spreadsheet…</p> : null}
      {metadataError ? <div role="alert" style={styles.error}>{metadataError} <button type="button" onClick={matchMetadata}>Try again</button></div> : null}
      {metadataPreview ? (
        <div role="status" style={styles.metadataStatus}>
          Matched spreadsheet row {metadataPreview.sheetRow}. Check the filled details before uploading.
          {metadataPreview.newGenreNames.length ? (
            <span> New genre{metadataPreview.newGenreNames.length > 1 ? "s" : ""}: {metadataPreview.newGenreNames.join(", ")}. These will be added to the catalogue at the Premium level when you upload; this track will stay in Draft for review.</span>
          ) : null}
          <span> Rights, territories and licensed product use are not taken from the spreadsheet. Confirm those yourself.</span>
        </div>
      ) : null}

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

      <fieldset style={styles.fieldset} disabled={uploading}>
        <legend style={styles.legend}>Licensed product use</legend>
        <div style={styles.checkboxGrid}>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="RETAIL_RADIO" defaultChecked />Retail Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="SCHOOL_RADIO" defaultChecked />School Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="ONLINE_RADIO" defaultChecked />Online Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="HEALTH_RADIO" />Health Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="FAITH_RADIO" />Faith Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="ORGANISATIONS_RADIO" />Ruvanas Organisations</label>
        </div>
        <p style={styles.hint}>Select only the Ruvanas services covered by the music licence.</p>
      </fieldset>

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
        <label style={styles.checkLabel}>
          <input type="checkbox" name="licensedCatalogue" disabled={uploading} />
          Apply Licensed Music Catalogue plan and genre controls
        </label>
        <p style={styles.hint}>
          Leave this unchecked to keep the track in Draft. Even a Ready track will not play until you add it to a Music Mode and publish a schedule.
        </p>
      </div>

      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
      {success ? <div role="status" style={styles.success}>{success}</div> : null}

      <button type="submit" disabled={uploading || previewing} style={styles.button}>
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
  metadataStatus: { padding: 12, border: "1px solid #93c5fd", borderRadius: 7, background: "#eff6ff", color: "#1e3a8a", fontWeight: 700, lineHeight: 1.5 },
  button: { justifySelf: "start", border: 0, borderRadius: 7, background: "#f4b942", color: "#172033", padding: "12px 17px", fontWeight: 900, cursor: "pointer" }
};

