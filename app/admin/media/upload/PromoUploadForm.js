"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const blank = {
  organisationId: "",
  promoAssetId: "",
  name: "",
  mediaType: "COMMERCIAL",
  languageCode: "und",
  durationSeconds: ""
};

export default function PromoUploadForm({ organisations, initialPromoAssetId }) {
  const router = useRouter();
  const initialAsset = organisations
    .flatMap((organisation) => organisation.promoAssets.map((asset) => ({ ...asset, organisationId: organisation.id })))
    .find((asset) => asset.id === initialPromoAssetId);
  const [form, setForm] = useState(
    initialAsset
      ? {
          ...blank,
          organisationId: initialAsset.organisationId,
          promoAssetId: initialAsset.id,
          name: initialAsset.name,
          mediaType: initialAsset.mediaType,
          languageCode: initialAsset.languageCode
        }
      : { ...blank, organisationId: organisations[0]?.id || "" }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const availableAssets = useMemo(
    () => organisations.find((organisation) => organisation.id === form.organisationId)?.promoAssets || [],
    [form.organisationId, organisations]
  );
  const isNewVersion = Boolean(form.promoAssetId);

  function update(event) {
    const { name, value } = event.target;
    if (name === "organisationId") {
      setForm({ ...blank, organisationId: value });
      return;
    }
    if (name === "promoAssetId") {
      const asset = availableAssets.find((item) => item.id === value);
      setForm((current) => asset
        ? { ...current, promoAssetId: asset.id, name: asset.name, mediaType: asset.mediaType, languageCode: asset.languageCode }
        : { ...current, promoAssetId: "", name: "", mediaType: "COMMERCIAL", languageCode: "und" });
      return;
    }
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = new FormData(event.currentTarget);
      if (!form.promoAssetId) data.delete("promoAssetId");
      const response = await fetch("/api/media/upload", { method: "POST", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The promotional audio could not be uploaded.");
      router.push("/admin/media");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The promotional audio could not be uploaded.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={styles.page}>
      <p style={styles.eyebrow}>Versioned Promo Library</p>
      <h1 style={styles.title}>{isNewVersion ? "Upload a new version" : "Upload a promotional asset"}</h1>
      <p style={styles.description}>The original audio stays protected. Every upload receives an immutable version, QC state, audit record, and queued preview, transcode, and loudness work.</p>
      {error ? <div style={styles.error}>{error}</div> : null}
      <form onSubmit={submit} style={styles.form}>
        <label style={styles.label}>Organisation
          <select required name="organisationId" value={form.organisationId} onChange={update} style={styles.input}>
            <option value="">Choose an organisation</option>
            {organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
          </select>
        </label>
        <label style={styles.label}>Create or version
          <select name="promoAssetId" value={form.promoAssetId} onChange={update} style={styles.input}>
            <option value="">Create a new promotional asset</option>
            {availableAssets.map((asset) => <option key={asset.id} value={asset.id}>New version of {asset.name}</option>)}
          </select>
        </label>
        <label style={styles.label}>Display name
          <input required name="name" maxLength={200} value={form.name} onChange={update} readOnly={isNewVersion} placeholder="Summer sale" style={{ ...styles.input, ...(isNewVersion ? styles.readOnly : {}) }} />
        </label>
        <label style={styles.label}>Audio type
          <select name="mediaType" value={form.mediaType} onChange={update} disabled={isNewVersion} style={styles.input}>
            <option value="COMMERCIAL">Commercial</option><option value="JINGLE">Jingle</option><option value="ANNOUNCEMENT">Announcement</option><option value="VOICEOVER">Voiceover</option>
          </select>
          {isNewVersion ? <input type="hidden" name="mediaType" value={form.mediaType} /> : null}
        </label>
        <label style={styles.label}>Language code
          <input required name="languageCode" maxLength={35} value={form.languageCode} onChange={update} placeholder="en, mt, en-GB" style={styles.input} />
        </label>
        <label style={styles.label}>Duration in seconds (optional)
          <input name="durationSeconds" type="number" min="1" step="1" value={form.durationSeconds} onChange={update} style={styles.input} />
        </label>
        <label style={styles.label}>Audio file
          <input required name="file" type="file" accept="audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/x-wav" style={styles.input} />
          <span style={styles.help}>Maximum 50 MB. The file signature is checked before storage.</span>
        </label>
        <div style={styles.notice}>New uploads enter <strong>In review</strong>. A manager must approve the exact version before a campaign can use it.</div>
        <div style={styles.actions}>
          <button disabled={saving || !form.organisationId} style={styles.button}>{saving ? "Uploading…" : "Upload for review"}</button>
          <Link href="/admin/media">Cancel</Link>
        </div>
      </form>
    </main>
  );
}

const styles = {
  page: { maxWidth: 760, margin: "0 auto", padding: "40px 16px 64px", color: "#172033" },
  eyebrow: { margin: "0 0 8px", color: "#9a6400", fontWeight: 900, textTransform: "uppercase" },
  title: { margin: 0, fontSize: 32 },
  description: { color: "#475569", lineHeight: 1.55 },
  error: { marginTop: 16, padding: 12, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 7, color: "#991b1b", fontWeight: 700 },
  form: { display: "grid", gap: 18, marginTop: 24, padding: 24, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" },
  label: { display: "grid", gap: 7, fontWeight: 800 },
  input: { padding: 10, border: "1px solid #94a3b8", borderRadius: 7, font: "inherit", background: "#fff" },
  readOnly: { background: "#e2e8f0", color: "#475569" },
  help: { color: "#64748b", fontSize: 12, fontWeight: 600 },
  notice: { padding: 12, border: "1px solid #fcd34d", borderRadius: 7, background: "#fffbeb", color: "#78350f", lineHeight: 1.45 },
  actions: { display: "flex", alignItems: "center", gap: 16 },
  button: { border: 0, borderRadius: 7, background: "#f4b942", color: "#172033", padding: "11px 15px", fontWeight: 900, cursor: "pointer" }
};
