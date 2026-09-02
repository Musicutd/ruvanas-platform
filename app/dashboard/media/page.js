"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import WorkflowProgress from "@/app/components/WorkflowProgress";
import { mediaWorkflowSteps, safeWorkflowMessage } from "@/lib/guided-workflows.mjs";
import styles from "./media-library.module.css";

export default function MediaLibraryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selectedFile, setSelectedFile] = useState("");
  const [detailsReviewed, setDetailsReviewed] = useState(false);

  const progress = useMemo(() => mediaWorkflowSteps({
    fileSelected: Boolean(selectedFile),
    detailsReviewed,
    uploaded: Boolean(result)
  }), [selectedFile, detailsReviewed, result]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/me");
        if (!response.ok) {
          if (!cancelled) router.push("/login");
          return;
        }
        const data = await response.json();
        if (!cancelled) setSession(data);
      } catch {
        if (!cancelled) router.push("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function handleUpload(event) {
    event.preventDefault();
    setError("");
    setResult(null);
    setDetailsReviewed(true);
    setUploading(true);

    try {
      const form = event.currentTarget;
      const file = form.file.files?.[0];
      if (!file) throw new Error("Choose an audio file before uploading.");

      const formData = new FormData();
      formData.append("file", file);
      formData.append("organisationId", session.organisation.id);
      formData.append("name", form.name.value.trim() || file.name);
      formData.append("mediaType", form.mediaType.value);
      formData.append("languageCode", form.languageCode.value.trim() || "und");
      if (form.durationSeconds.value) formData.append("durationSeconds", String(Number(form.durationSeconds.value)));

      const response = await fetch("/api/media/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The upload could not be completed.");

      setResult(data);
      form.reset();
    } catch (uploadError) {
      setError(safeWorkflowMessage(uploadError, "The upload could not be completed. Please try again."));
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <main className={styles.page}><p>Loading your media library…</p></main>;
  if (!session) return null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
        <Link href="/dashboard" className={styles.back}>Back to your home</Link>
      </header>

      <section className={styles.content}>
        <p className={styles.eyebrow}>AUDIO LIBRARY</p>
        <h1>Upload audio</h1>
        <p className={styles.subtitle}>Add an announcement, jingle, voiceover or commercial to {session.organisation.name}. Every upload is checked before it can be used.</p>

        <WorkflowProgress title="Audio upload" steps={progress} />

        <aside className={styles.guidance}>
          <strong>Use the original audio file.</strong>
          <span>Do not rename another file type to look like audio. Ruvanas checks the real file format and keeps the upload private during review.</span>
        </aside>

        <form onSubmit={handleUpload} className={styles.form} onChange={() => selectedFile && setDetailsReviewed(true)}>
          <label>
            <span>1. Choose the audio file</span>
            <input type="file" name="file" accept="audio/*" required disabled={uploading} onChange={(event) => { setSelectedFile(event.target.files?.[0]?.name || ""); setDetailsReviewed(false); setResult(null); }} />
            <small>{selectedFile || "Choose the file from this computer or device."}</small>
          </label>

          <div className={styles.columns}>
            <label>
              <span>Audio name <em>optional</em></span>
              <input type="text" name="name" maxLength={160} placeholder="Example: Morning welcome" disabled={uploading} />
            </label>
            <label>
              <span>Audio type</span>
              <select name="mediaType" defaultValue="COMMERCIAL" disabled={uploading}>
                <option value="COMMERCIAL">Commercial</option>
                <option value="JINGLE">Jingle</option>
                <option value="ANNOUNCEMENT">Announcement</option>
                <option value="VOICEOVER">Voiceover</option>
              </select>
            </label>
          </div>

          <div className={styles.columns}>
            <label>
              <span>Language</span>
              <input type="text" name="languageCode" defaultValue="und" maxLength={20} placeholder="en, mt or en-GB" disabled={uploading} />
              <small>Use “und” if the audio has no spoken language.</small>
            </label>
            <label>
              <span>Duration in seconds <em>optional</em></span>
              <input type="number" name="durationSeconds" min="1" max="86400" placeholder="Example: 30" disabled={uploading} />
            </label>
          </div>

          {error ? <div className={styles.error} role="alert"><strong>Upload needs attention</strong><span>{error}</span></div> : null}

          <button type="submit" disabled={uploading || !selectedFile}>
            {uploading ? "Uploading securely…" : "Upload for review"}
          </button>
        </form>

        {result ? (
          <section className={styles.success} aria-live="polite">
            <strong>Upload received for review</strong>
            <p>{result.name} is safely stored as version {result.version}. Current status: {result.status}.</p>
            <dl>
              <div><dt>Type</dt><dd>{result.mediaType}</dd></div>
              <div><dt>Language</dt><dd>{result.languageCode}</dd></div>
              <div><dt>File size</dt><dd>{Number(result.sizeBytes).toLocaleString()} bytes</dd></div>
              {result.durationSeconds ? <div><dt>Duration</dt><dd>{result.durationSeconds} seconds</dd></div> : null}
            </dl>
            <div className={styles.successActions}>
              <a href={result.url} target="_blank" rel="noreferrer">Check uploaded audio</a>
              <button type="button" onClick={() => { setResult(null); setSelectedFile(""); setDetailsReviewed(false); }}>Upload another file</button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
