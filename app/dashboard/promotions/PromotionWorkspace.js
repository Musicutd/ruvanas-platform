"use client";

import { useEffect, useMemo, useState } from "react";
import { PROMOTION_WEEKDAYS, promotionStatusLabel } from "@/lib/subscriber-promotions.mjs";
import styles from "./promotions.module.css";

const today = () => new Date().toISOString().slice(0, 10);
const nextWeek = () => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const emptyWindow = () => ({ weekday: 1, startsAt: "09:00", endsAt: "17:00" });

function timeLabel(minute) {
  if (!Number.isFinite(minute)) return "";
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export default function PromotionWorkspace({ organisationName, initialPromoVersionId = "" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [publishReview, setPublishReview] = useState("");
  const [form, setForm] = useState({
    name: "",
    promoVersionId: initialPromoVersionId,
    effectiveFrom: today(),
    effectiveTo: nextWeek(),
    targetKey: "ALL_LOCATIONS:all",
    schedulingMode: "PLAYS_PER_HOUR",
    playsPerHour: 2,
    intervalMinutes: 30,
    respectOpeningHours: true,
    schedules: [emptyWindow()]
  });

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/promotions", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load promotions.");
      setData(payload);
      setForm((current) => ({
        ...current,
        promoVersionId: payload.promos.some((promo) => promo.id === current.promoVersionId)
          ? current.promoVersionId
          : payload.promos[0]?.id || ""
      }));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const selectedTarget = useMemo(() => {
    if (!data) return null;
    const [type, id] = form.targetKey.split(":");
    return data.targets.find((target) => target.type === type && target.id === id) || null;
  }, [data, form.targetKey]);

  function change(next) {
    setForm((current) => ({ ...current, ...next }));
    setPreview(null);
    setReviewed(false);
  }

  function updateWindow(index, field, value) {
    change({ schedules: form.schedules.map((entry, current) => current === index ? { ...entry, [field]: field === "weekday" ? Number(value) : value } : entry) });
  }

  function payload(previewOnly) {
    return {
      ...form,
      previewOnly,
      previewAcknowledged: previewOnly ? false : reviewed,
      targets: [{ targetType: selectedTarget?.type, targetId: selectedTarget?.type === "ALL_LOCATIONS" ? "" : selectedTarget?.id }]
    };
  }

  async function submit(previewOnly) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(previewOnly))
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to check this promotion.");
      setPreview(result.preview);
      if (previewOnly) {
        setReviewed(false);
        setNotice("Preview ready. Check the coverage, dates and expected delivery before saving.");
      } else {
        setNotice("Promotion saved as a controlled draft. An owner or manager can publish it below.");
        setReviewed(false);
        setForm((current) => ({ ...current, name: "" }));
        await load();
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setWorking(false);
    }
  }

  async function action(campaignId, action) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/promotions/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, previewAcknowledged: action !== "PUBLISH" || publishReview === campaignId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update this promotion.");
      setNotice(action === "PUBLISH" ? "Promotion published. Its approved schedule is now live." : action === "PAUSE" ? "Promotion paused." : "Promotion archived.");
      setPublishReview("");
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <div className={styles.loading}>Loading {organisationName}&apos;s promotions…</div>;
  if (!data) return <div className={styles.error}>{error || "Promotions are unavailable."}</div>;

  return (
    <div className={styles.workspace}>
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

      <section className={styles.panel} aria-labelledby="create-promotion-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>CREATE</p><h2 id="create-promotion-title">Plan a promotion</h2></div>
          <span className={data.canDraft ? styles.permission : styles.readOnly}>{data.canDraft ? "Draft access" : "View only"}</span>
        </div>
        {!data.canDraft ? <p className={styles.emptyState}>Your role can review promotions. An owner, manager or content editor can prepare a new draft.</p> : data.promos.length === 0 ? (
          <p className={styles.emptyState}>No approved promotional audio is ready yet. Upload audio in the Media library or ask Ruvanas Studio to prepare it, then complete approval before scheduling.</p>
        ) : (
          <>
            <div className={styles.formGrid}>
              <label><span>Promotion name</span><input maxLength="120" value={form.name} onChange={(event) => change({ name: event.target.value })} placeholder="September lunch offer" /></label>
              <label><span>Approved audio</span><select value={form.promoVersionId} onChange={(event) => change({ promoVersionId: event.target.value })}>{data.promos.map((promo) => <option value={promo.id} key={promo.id}>{promo.name} · version {promo.version}</option>)}</select></label>
              <label><span>Listening area</span><select value={form.targetKey} onChange={(event) => change({ targetKey: event.target.value })}>{data.targets.map((target) => <option value={`${target.type}:${target.id}`} key={`${target.type}:${target.id}`}>{target.label}</option>)}</select></label>
              <label><span>Frequency</span><select value={form.schedulingMode} onChange={(event) => change({ schedulingMode: event.target.value })}><option value="PLAYS_PER_HOUR">Plays per hour</option><option value="INTERVAL">Every number of minutes</option></select></label>
              {form.schedulingMode === "PLAYS_PER_HOUR" ? <label><span>Plays each hour</span><input type="number" min="1" max="4" value={form.playsPerHour} onChange={(event) => change({ playsPerHour: Number(event.target.value) })} /></label> : <label><span>Minutes between plays</span><input type="number" min="15" max="180" value={form.intervalMinutes} onChange={(event) => change({ intervalMinutes: Number(event.target.value) })} /></label>}
              <label><span>Start date</span><input type="date" value={form.effectiveFrom} onChange={(event) => change({ effectiveFrom: event.target.value })} /></label>
              <label><span>End date</span><input type="date" value={form.effectiveTo} onChange={(event) => change({ effectiveTo: event.target.value })} /></label>
              <label className={styles.checkbox}><input type="checkbox" checked={form.respectOpeningHours} onChange={(event) => change({ respectOpeningHours: event.target.checked })} /><span>Play only during configured opening hours</span></label>
            </div>

            <div className={styles.windowHeading}><h3>Weekly time windows</h3><button type="button" className={styles.secondaryButton} onClick={() => change({ schedules: [...form.schedules, emptyWindow()] })}>+ Add window</button></div>
            <div className={styles.windowList}>{form.schedules.map((entry, index) => (
              <div className={styles.windowRow} key={`window-${index}`}>
                <label><span>Day</span><select value={entry.weekday} onChange={(event) => updateWindow(index, "weekday", event.target.value)}>{PROMOTION_WEEKDAYS.map((day, weekday) => <option value={weekday} key={day}>{day}</option>)}</select></label>
                <label><span>From</span><input type="time" value={entry.startsAt} onChange={(event) => updateWindow(index, "startsAt", event.target.value)} /></label>
                <label><span>To</span><input type="time" value={entry.endsAt} onChange={(event) => updateWindow(index, "endsAt", event.target.value)} /></label>
                <button type="button" className={styles.removeButton} disabled={form.schedules.length === 1} onClick={() => change({ schedules: form.schedules.filter((_, current) => current !== index) })}>Remove</button>
              </div>
            ))}</div>
            <div className={styles.actionBar}>
              <button type="button" className={styles.secondaryButton} disabled={working || !form.name || !selectedTarget} onClick={() => submit(true)}>Preview delivery</button>
              <button type="button" className={styles.primaryButton} disabled={working || !reviewed || !preview?.canPublish} onClick={() => submit(false)}>Save checked draft</button>
            </div>
            {preview ? <div className={preview.canPublish ? styles.previewGood : styles.previewBad}>
              <p className={styles.kicker}>{preview.canPublish ? "READY TO SAVE" : "NEEDS ATTENTION"}</p>
              <h3>{preview.targetZoneCount} playback zone{preview.targetZoneCount === 1 ? "" : "s"}</h3>
              <p><strong>{preview.estimatedTotalPlays}</strong> estimated plays across {preview.activeDays} days. This is a scheduling estimate, not an audience or listener count.</p>
              {preview.errors.map((item) => <p className={styles.blocker} key={item}>{item}</p>)}
              {preview.warnings.map((item) => <p className={styles.warning} key={item}>{item}</p>)}
              {preview.canPublish ? <label className={styles.reviewCheck}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the audio, dates, listening area, frequency and expected delivery.</span></label> : null}
            </div> : null}
          </>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="promotion-list-title">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>SCHEDULED AUDIO</p><h2 id="promotion-list-title">Promotion activity</h2></div><span className={styles.count}>{data.campaigns.length} visible</span></div>
        <div className={styles.campaignList}>{data.campaigns.map((campaign) => {
          const status = promotionStatusLabel(campaign);
          return <article className={styles.campaignCard} key={campaign.id}>
            <div><span className={`${styles.status} ${styles[`status${status}`] || ""}`}>{status.replaceAll("_", " ")}</span><h3>{campaign.name}</h3><p>{campaign.promo.name} · version {campaign.promo.version}</p></div>
            <dl><div><dt>Dates</dt><dd>{campaign.effectiveFrom} — {campaign.effectiveTo}</dd></div><div><dt>Coverage</dt><dd>{campaign.targets.map((target) => target.label).join(", ")}</dd></div><div><dt>Windows</dt><dd>{campaign.schedules.length} weekly window{campaign.schedules.length === 1 ? "" : "s"}</dd></div></dl>
            {campaign.protected ? <span className={styles.protected}>Managed through Ruvanas operations</span> : data.canPublish ? <div className={styles.cardActions}>
              {campaign.status === "DRAFT" ? <><label className={styles.smallCheck}><input type="checkbox" checked={publishReview === campaign.id} onChange={(event) => setPublishReview(event.target.checked ? campaign.id : "")} /><span>Reviewed</span></label><button type="button" className={styles.primaryButton} disabled={working || publishReview !== campaign.id} onClick={() => action(campaign.id, "PUBLISH")}>Publish</button></> : null}
              {campaign.status === "PUBLISHED" ? <button type="button" className={styles.secondaryButton} disabled={working} onClick={() => action(campaign.id, "PAUSE")}>Pause</button> : null}
              {["DRAFT", "PAUSED", "ENDED"].includes(campaign.status) ? <button type="button" className={styles.ghostButton} disabled={working} onClick={() => action(campaign.id, "ARCHIVE")}>Archive</button> : null}
            </div> : null}
          </article>;
        })}{data.campaigns.length === 0 ? <p className={styles.emptyState}>No promotion drafts or live campaigns yet. Your first checked draft will appear here.</p> : null}</div>
      </section>
    </div>
  );
}
