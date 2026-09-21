"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const TEMPLATE = `#,File,Artist,Title,Mix,Time,BPM,Genre,Content Warning,Album,Release Year
1,01 Example Artist - Example Song.mp3,Example Artist,Example Song,Clean,3:17,121,R&B,,Example Album,2026
`;

export default function CatalogueBulkUploadForm() {
  const router = useRouter();
  const formRef = useRef(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ruvanas-catalogue-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function processBatch(mode) {
    const form = formRef.current;
    if (!form) return;
    setWorking(mode);
    setError("");
    setResult(null);
    try {
      const data = new FormData(form);
      data.set("mode", mode);
      const response = await fetch("/api/admin/catalogue/bulk-upload", { method: "POST", body: data });
      const body = await response.json();
      if (!response.ok) {
        if (body.preview) setPreview(body.preview);
        throw new Error(body.error || "The catalogue batch could not be processed.");
      }
      if (mode === "validate") {
        setPreview(body.preview);
        return;
      }
      setResult(body);
      if (body.failures?.length) setError(`${body.imported.length} tracks were imported, but ${body.failures.length} need attention.`);
      else {
        setPreview(null);
        form.reset();
      }
      router.refresh();
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "The catalogue batch could not be processed.");
    } finally {
      setWorking("");
    }
  }

  return (
    <form ref={formRef} style={styles.form} onSubmit={(event) => { event.preventDefault(); processBatch("validate"); }}>
      <div style={styles.intro}>
        <div><strong>1. Choose the files</strong><p>Put the audio files in one ZIP. Add the metadata in one CSV or XLSX spreadsheet.</p></div>
        <button type="button" onClick={downloadTemplate} style={styles.secondaryButton}>Download CSV template</button>
      </div>

      <div style={styles.grid}>
        <label style={styles.label}>Music ZIP
          <input name="archive" type="file" accept=".zip,application/zip" required disabled={Boolean(working)} style={styles.input} onChange={() => setPreview(null)} />
          <span style={styles.hint}>Up to 100 MP3, WAV, OGG or M4A files; ZIP maximum 150 MB.</span>
        </label>
        <label style={styles.label}>Metadata spreadsheet
          <input name="manifest" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required disabled={Boolean(working)} style={styles.input} onChange={() => setPreview(null)} />
          <span style={styles.hint}>Your current Artist, Title, Mix, Time, BPM, Genre and Content Warning columns are supported.</span>
        </label>
      </div>

      <div style={styles.info}>
        <strong>Automatic matching</strong>
        <span>The File column is optional when each audio filename starts with the spreadsheet row number or contains the artist and title.</span>
        <span>HTML text such as <code>R&amp;amp;B</code> is decoded and matched to the existing <strong>R&amp;B</strong> genre.</span>
      </div>

      <fieldset style={styles.fieldset} disabled={Boolean(working)}>
        <legend style={styles.legend}>2. Rights for this batch</legend>
        <div style={styles.grid}>
          <label style={styles.label}>Rights holder or licensor<input name="rightsHolder" required maxLength={200} style={styles.input} /></label>
          <label style={styles.label}>Licence or rights reference<input name="rightsReference" required maxLength={500} style={styles.input} /></label>
          <label style={styles.label}>Permitted territories<input name="permittedTerritories" required maxLength={500} style={styles.input} placeholder="For example: Worldwide or Malta and EU" /></label>
          <label style={styles.label}>Licence expiry (optional)<input name="licenceExpiresAt" type="date" style={styles.input} /></label>
        </div>
      </fieldset>

      <fieldset style={styles.fieldset} disabled={Boolean(working)}>
        <legend style={styles.legend}>Licensed product use</legend>
        <div style={styles.checkboxGrid}>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="RETAIL_RADIO" defaultChecked />Retail Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="SCHOOL_RADIO" defaultChecked />School Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="ONLINE_RADIO" defaultChecked />Online Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="HEALTH_RADIO" />Health Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="FAITH_RADIO" />Faith Radio</label>
          <label style={styles.checkLabel}><input type="checkbox" name="permittedUses" value="ORGANISATIONS_RADIO" />Ruvanas Organisations</label>
        </div>
      </fieldset>

      <div style={styles.confirmations}>
        <label style={styles.checkLabelStrong}><input type="checkbox" name="rightsConfirmed" required disabled={Boolean(working)} />I confirm that Ruvanas is authorised to store, distribute and programme every recording in this batch.</label>
        <label style={styles.checkLabel}><input type="checkbox" name="publishNow" disabled={Boolean(working)} />Mark valid imported tracks ready for programming immediately</label>
        <label style={styles.checkLabel}><input type="checkbox" name="licensedCatalogue" disabled={Boolean(working)} />Apply Licensed Music Catalogue plan and genre controls</label>
      </div>

      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
      {result?.imported?.length ? <div role="status" style={styles.success}>{result.imported.length} catalogue tracks imported successfully.</div> : null}

      <div style={styles.actions}>
        <button type="submit" disabled={Boolean(working)} style={styles.button}>{working === "validate" ? "Checking files…" : "Check files"}</button>
        {preview ? <button type="button" disabled={Boolean(working) || !preview.ready} onClick={() => processBatch("import")} style={{ ...styles.button, ...styles.importButton }}>{working === "import" ? "Importing securely…" : `Import ${preview.summary.matchedTracks} tracks`}</button> : null}
      </div>

      {preview ? <Preview preview={preview} /> : null}
      {result?.failures?.length ? <div style={styles.error}><strong>Tracks needing attention</strong>{result.failures.map((failure) => <div key={failure.sheetRow}>Row {failure.sheetRow}: {failure.artist} — {failure.title}: {failure.error}</div>)}</div> : null}
    </form>
  );
}

function Preview({ preview }) {
  return <section style={styles.preview} aria-label="Bulk import check">
    <div style={styles.previewHeader}>
      <div><strong>3. Review before import</strong><p>{preview.summary.matchedTracks} ready · {preview.summary.invalidRows} need attention · {preview.summary.audioFiles} audio files found</p></div>
      <span style={preview.ready ? styles.ready : styles.notReady}>{preview.ready ? "Ready to import" : "Fix highlighted rows"}</span>
    </div>
    {preview.unmatchedFiles.length ? <div style={styles.warning}><strong>Audio not used by the spreadsheet:</strong> {preview.unmatchedFiles.join(", ")}</div> : null}
    <div style={styles.tableWrap}><table style={styles.table}><thead><tr><th style={styles.previewHeaderCell}>Row</th><th style={styles.previewHeaderCell}>Audio</th><th style={styles.previewHeaderCell}>Track</th><th style={styles.previewHeaderCell}>Mix / BPM</th><th style={styles.previewHeaderCell}>Genre</th><th style={styles.previewHeaderCell}>Check</th></tr></thead><tbody>
      {preview.rows.map((row) => <tr key={row.sheetRow} style={row.errors.length ? styles.badRow : undefined}>
        <td style={styles.previewCell}>{row.sheetRow}</td><td style={styles.previewCell}>{row.fileName || "Not matched"}</td><td style={styles.previewCell}><strong>{row.artist} — {row.title}</strong>{row.isExplicit ? <small style={styles.block}>Explicit content</small> : null}</td><td style={styles.previewCell}>{row.mixName || "—"} / {row.bpm || "—"}</td><td style={styles.previewCell}>{row.genres.length ? row.genres.join(", ") : "Uncategorised"}{row.notes.map((note) => <small key={note} style={styles.block}>{note}</small>)}</td><td style={styles.previewCell}>{row.errors.length ? row.errors.map((item) => <small key={item} style={styles.issue}>{item}</small>) : <span style={styles.good}>Ready</span>}</td>
      </tr>)}
    </tbody></table></div>
  </section>;
}

const styles = {
  form: { display: "grid", gap: 18 },
  intro: { display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 },
  label: { display: "grid", gap: 7, color: "#172033", fontSize: 14, fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#111827", font: "inherit" },
  hint: { color: "#64748b", fontSize: 12, fontWeight: 600, lineHeight: 1.45 },
  info: { display: "grid", gap: 5, padding: 14, border: "1px solid #93c5fd", borderRadius: 8, background: "#eff6ff", color: "#1e3a8a", fontSize: 13, lineHeight: 1.5 },
  fieldset: { margin: 0, padding: 16, border: "1px solid #cbd5e1", borderRadius: 8 },
  legend: { padding: "0 7px", color: "#172033", fontSize: 14, fontWeight: 900 },
  checkboxGrid: { display: "flex", flexWrap: "wrap", gap: "10px 18px" },
  confirmations: { display: "grid", gap: 12, padding: 16, border: "1px solid #fbbf24", borderRadius: 8, background: "#fffbeb" },
  checkLabel: { display: "flex", alignItems: "flex-start", gap: 9, color: "#334155", fontSize: 14, fontWeight: 700, lineHeight: 1.45 },
  checkLabelStrong: { display: "flex", alignItems: "flex-start", gap: 9, color: "#78350f", fontSize: 14, fontWeight: 900, lineHeight: 1.45 },
  actions: { display: "flex", gap: 10, flexWrap: "wrap" },
  button: { border: 0, borderRadius: 7, background: "#172033", color: "#fff", padding: "12px 17px", fontWeight: 900, cursor: "pointer" },
  importButton: { background: "#f4b942", color: "#172033" },
  secondaryButton: { border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", color: "#172033", padding: "10px 14px", fontWeight: 800, cursor: "pointer" },
  error: { display: "grid", gap: 6, padding: 12, border: "1px solid #fca5a5", borderRadius: 7, background: "#fef2f2", color: "#991b1b", fontWeight: 700 },
  success: { padding: 12, border: "1px solid #86efac", borderRadius: 7, background: "#f0fdf4", color: "#166534", fontWeight: 700 },
  preview: { display: "grid", gap: 14, paddingTop: 6 },
  previewHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" },
  ready: { borderRadius: 999, background: "#dcfce7", color: "#166534", padding: "7px 11px", fontSize: 12, fontWeight: 900 },
  notReady: { borderRadius: 999, background: "#fee2e2", color: "#991b1b", padding: "7px 11px", fontSize: 12, fontWeight: 900 },
  warning: { padding: 12, border: "1px solid #fbbf24", borderRadius: 7, background: "#fffbeb", color: "#78350f", fontSize: 13 },
  tableWrap: { overflowX: "auto", border: "1px solid #cbd5e1", borderRadius: 8 },
  table: { width: "100%", minWidth: 900, borderCollapse: "collapse" },
  previewHeaderCell: { padding: "11px 10px", borderBottom: "2px solid #94a3b8", background: "#e2e8f0", color: "#172033", fontSize: 12, fontWeight: 900, textAlign: "left" },
  previewCell: { padding: "11px 10px", borderBottom: "1px solid #cbd5e1", color: "#334155", fontSize: 13, verticalAlign: "top" },
  badRow: { background: "#fff1f2" },
  block: { display: "block", marginTop: 4, color: "#64748b" },
  issue: { display: "block", marginBottom: 4, color: "#b91c1c", fontWeight: 800 },
  good: { color: "#166534", fontWeight: 900 }
};
