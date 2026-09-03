"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ContextHelp from "@/app/components/ContextHelp";
import SkipLink from "@/app/components/SkipLink";
import { safeWorkflowMessage } from "@/lib/guided-workflows.mjs";
import styles from "./media-library.module.css";

const TYPE_LABELS = { COMMERCIAL: "Commercial", JINGLE: "Jingle", ANNOUNCEMENT: "Announcement", VOICEOVER: "Voiceover" };

function librarySummary(assets) {
  const versions = assets.flatMap((asset) => asset.versions);
  return {
    audio: assets.length,
    drafts: versions.filter((version) => version.status === "DRAFT").length,
    review: versions.filter((version) => version.status === "IN_REVIEW").length,
    approved: assets.filter((asset) => asset.currentApprovedVersionId).length
  };
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Not yet";
}

export default function MediaLibraryPage() {
  const router = useRouter();
  const uploadRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [library, setLibrary] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submittingId, setSubmittingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [replacement, setReplacement] = useState(null);

  async function loadLibrary() {
    const response = await fetch("/api/media/library", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load the audio library.");
    setLibrary(payload);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) router.push("/login");
          return;
        }
        const data = await response.json();
        if (!cancelled) setSession(data);
        const libraryResponse = await fetch("/api/media/library", { cache: "no-store" });
        const libraryData = await libraryResponse.json();
        if (!libraryResponse.ok) throw new Error(libraryData.error || "Unable to load the audio library.");
        if (!cancelled) setLibrary(libraryData);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const totals = useMemo(() => librarySummary(library?.assets || []), [library]);

  async function handleUpload(event) {
    event.preventDefault();
    setError(""); setNotice(""); setUploading(true);
    try {
      const form = event.currentTarget;
      const file = form.file.files?.[0];
      if (!file) throw new Error("Choose an audio file before uploading.");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("organisationId", session.organisation.id);
      formData.append("name", form.elements.name.value.trim() || file.name);
      formData.append("mediaType", form.mediaType.value);
      formData.append("languageCode", form.languageCode.value.trim() || "und");
      if (replacement?.id) formData.append("promoAssetId", replacement.id);
      if (form.durationSeconds.value) formData.append("durationSeconds", form.durationSeconds.value);
      const response = await fetch("/api/media/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The upload could not be completed.");
      setNotice(`${data.name} version ${data.version} is stored privately as a draft. Preview it below, then submit it when ready.`);
      setSelectedFile(""); setReplacement(null); form.reset(); form.languageCode.value = "und";
      await loadLibrary();
    } catch (uploadError) {
      setError(safeWorkflowMessage(uploadError, "The upload could not be completed. Please try again."));
    } finally { setUploading(false); }
  }

  async function submitForReview(version) {
    setError(""); setNotice(""); setSubmittingId(version.id);
    try {
      const response = await fetch(`/api/media/library/${version.id}/submit`, { method: "PATCH" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The audio could not be submitted.");
      setNotice("Audio submitted. Ruvanas will complete the final quality and rights review.");
      await loadLibrary();
    } catch (submitError) { setError(submitError.message); }
    finally { setSubmittingId(""); }
  }

  function startReplacement(asset) {
    setReplacement(asset); setSelectedFile(""); setNotice(`Choose the corrected file for ${asset.name}. It will be stored as a new version.`); setError("");
    requestAnimationFrame(() => uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  if (loading) return <main className={styles.page}><p className={styles.loading}>Loading your audio library…</p></main>;
  if (!session || !library) return <main className={styles.page}><div className={styles.content}>{error ? <div className={styles.error}>{error}</div> : null}</div></main>;

  return (
    <main className={styles.page}>
      <SkipLink />
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.brand}>RUVANAS</Link>
        <nav><Link href="/dashboard/promotions">Promotions Planner</Link><Link href="/dashboard" className={styles.back}>Dashboard</Link></nav>
      </header>
      <section className={styles.content} id="main-content">
        <div className={styles.hero}>
          <div><p className={styles.eyebrow}>SUBSCRIBER AUDIO</p><h1>Your audio library</h1><p className={styles.subtitle}>Upload, listen, submit and follow every version for {library.organisation.name}. Nothing can be scheduled until Ruvanas approves it.</p></div>
          <span className={styles.role}>{library.permissions.role.replaceAll("_", " ")}</span>
        </div>
        <div className={styles.metrics} aria-label="Audio library summary">
          <article><strong>{totals.audio}</strong><span>Audio items</span></article><article><strong>{totals.drafts}</strong><span>Draft versions</span></article><article><strong>{totals.review}</strong><span>With Ruvanas</span></article><article><strong>{totals.approved}</strong><span>Approved to schedule</span></article>
        </div>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

        {library.permissions.canUpload ? (
          <section className={styles.uploadPanel} ref={uploadRef} aria-labelledby="upload-title">
            <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>{replacement ? "REPLACEMENT VERSION" : "NEW AUDIO"}</p><h2 id="upload-title">{replacement ? `Replace ${replacement.name}` : "Upload audio"}</h2></div>{replacement ? <button type="button" className={styles.textButton} onClick={() => setReplacement(null)}>Cancel replacement</button> : null}</div>
            <p className={styles.panelIntro}>{replacement ? "The earlier version stays in the audit history. This corrected file becomes the next version." : "Your upload stays private as a draft until you listen and submit it."}</p>
            <form key={replacement?.id || "new-audio"} onSubmit={handleUpload} className={styles.form}>
              <label><span>Audio file</span><input type="file" name="file" accept="audio/*" required disabled={uploading} onChange={(event) => setSelectedFile(event.target.files?.[0]?.name || "")} /><small>{selectedFile || "Original MP3, WAV, M4A or supported audio file · maximum 50 MB"}</small></label>
              <div className={styles.columns}>
                <label><span>Audio name</span><input type="text" name="name" maxLength="160" defaultValue={replacement?.name || ""} placeholder="Morning welcome" disabled={uploading || Boolean(replacement)} /></label>
                <label><span>Audio type</span><select name="mediaType" defaultValue={replacement?.mediaType || "COMMERCIAL"} disabled={uploading || Boolean(replacement)}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              </div>
              <div className={styles.columns}>
                <label><span>Language</span><input type="text" name="languageCode" defaultValue={replacement?.languageCode || "und"} maxLength="20" disabled={uploading} /><small>Use “und” when there is no spoken language.</small></label>
                <label><span>Duration <em>optional</em></span><input type="number" name="durationSeconds" min="1" max="86400" placeholder="Seconds" disabled={uploading} /></label>
              </div>
              <button type="submit" disabled={uploading || !selectedFile}>{uploading ? "Uploading securely…" : replacement ? "Upload replacement version" : "Upload private draft"}</button>
            </form>
          </section>
        ) : <div className={styles.readOnly}>You can view and preview audio. An owner, manager or content editor can upload and submit versions.</div>}

        <ContextHelp title="How audio approval works" introduction="A clear five-step journey keeps subscriber audio safe and prevents unapproved material from going on air." items={[
          { title: "1. Upload", description: "The file is securely stored as a private draft." }, { title: "2. Preview", description: "Listen to the exact uploaded version before submitting." }, { title: "3. Submit", description: "An owner, manager or content editor sends it to Ruvanas." }, { title: "4. Review", description: "Ruvanas completes the final quality and rights decision." }, { title: "5. Schedule", description: "Approved audio becomes available in the Promotions Planner." }
        ]} articleHref="/dashboard/help#audio-uploads" articleLabel="Open the audio guide" />

        <section className={styles.libraryPanel} aria-labelledby="library-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>VERSIONS & REVIEW</p><h2 id="library-title">Audio status</h2></div><button type="button" className={styles.textButton} onClick={loadLibrary}>Refresh status</button></div>
          {library.assets.length === 0 ? <div className={styles.empty}><strong>No subscriber audio yet</strong><span>Upload your first announcement, jingle, voiceover or commercial above.</span></div> : (
            <div className={styles.assetList}>{library.assets.map((asset) => {
              const latest = asset.versions[0];
              return <article className={styles.assetCard} key={asset.id}>
                <div className={styles.assetHeading}><div><span className={styles.type}>{TYPE_LABELS[asset.mediaType] || asset.mediaType}</span><h3>{asset.name}</h3><p>Latest version {latest.version} · updated {formatDate(asset.updatedAt)}</p></div><span className={`${styles.status} ${styles[`status${latest.review.key}`] || ""}`}>{latest.review.label}</span></div>
                <div className={styles.versionList}>{asset.versions.map((version) => (
                  <section className={styles.version} key={version.id}>
                    <div className={styles.versionMeta}><strong>Version {version.version}</strong><span>{formatDate(version.createdAt)}</span>{asset.currentApprovedVersionId === version.id ? <span className={styles.current}>Current approved version</span> : null}</div>
                    <p className={styles.stateText}>{version.review.description}</p>
                    {version.status === "REJECTED" && version.qcNotes ? <div className={styles.reviewNote}><strong>Ruvanas review note</strong><span>{version.qcNotes}</span></div> : null}
                    <audio controls preload="none" src={version.previewUrl}>Your browser does not support secure audio preview.</audio>
                    <div className={styles.versionActions}>
                      {version.review.canSubmit && library.permissions.canSubmit ? <button type="button" className={styles.primaryButton} disabled={submittingId === version.id} onClick={() => submitForReview(version)}>{submittingId === version.id ? "Submitting…" : "Submit for Ruvanas review"}</button> : null}
                      {version.status === "APPROVED" ? <Link className={styles.primaryLink} href={`/dashboard/promotions?promoVersionId=${version.id}`}>Schedule this audio</Link> : null}
                      {version.review.canReplace && library.permissions.canUpload && latest.id === version.id ? <button type="button" className={styles.secondaryButton} onClick={() => startReplacement(asset)}>Upload corrected version</button> : null}
                    </div>
                  </section>
                ))}</div>
              </article>;
            })}</div>
          )}
        </section>
      </section>
    </main>
  );
}
