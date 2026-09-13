"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./plans.module.css";

const PRODUCT_FIELDS = [
  ["Retail", "retailRadioEnabled"],
  ["School", "schoolRadioEnabled"],
  ["Online", "onlineRadioEnabled"],
  ["Health", "healthRadioEnabled"],
  ["Faith", "faithRadioEnabled"],
  ["Organisations", "organisationsEnabled"]
];

const EXTRA_FIELDS = [
  ["Promotional uploads", "promoUploadEnabled"],
  ["School public publishing", "schoolPublicPublishingEnabled"],
  ["Retail media", "retailMediaEnabled"],
  ["Digital signage", "digitalSignageEnabled"]
];

function formatPrice(plan) {
  const amount = new Intl.NumberFormat("en-MT", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(plan.monthlyPriceCents / 100);
  return plan.tierNumber === 5 ? `From ${amount}` : amount;
}

function productBadges(plan) {
  return PRODUCT_FIELDS.filter(([, field]) => plan[field]).map(([label]) => label);
}

function integerValue(value, fallback = 0) {
  const result = Number(value);
  return Number.isInteger(result) ? result : fallback;
}

export default function PlanCatalogueEditor({ initialPlans, productLabels }) {
  const [plans, setPlans] = useState(initialPlans);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState({ tone: "", message: "" });
  const formRef = useRef(null);

  useEffect(() => {
    if (!draft || !formRef.current) return;
    formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draft]);

  function beginEdit(plan) {
    setEditingId(plan.id);
    setDraft({ ...plan, monthlyPrice: (plan.monthlyPriceCents / 100).toFixed(plan.monthlyPriceCents % 100 ? 2 : 0) });
    setStatus({ tone: "", message: "" });
  }

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (!draft || working) return;
    const monthlyPriceCents = Math.round(Number(draft.monthlyPrice) * 100);
    if (!Number.isFinite(monthlyPriceCents)) {
      setStatus({ tone: "error", message: "Enter a valid monthly price." });
      return;
    }
    setWorking(true);
    setStatus({ tone: "", message: "" });
    try {
      const payload = {
        expectedUpdatedAt: draft.updatedAt,
        name: draft.name,
        tierNumber: integerValue(draft.tierNumber),
        monthlyPriceCents,
        stationLimit: integerValue(draft.stationLimit),
        storageLimitGb: integerValue(draft.storageLimitGb),
        listenerLimit: integerValue(draft.listenerLimit),
        maxBitrateKbps: integerValue(draft.maxBitrateKbps),
        studioExternalDestinationLimit: draft.studioExternalDestinationLimit === "" || draft.studioExternalDestinationLimit == null ? null : integerValue(draft.studioExternalDestinationLimit),
        licensedMusicCatalogueLevel: draft.licensedMusicCatalogueLevel,
        promoUploadEnabled: Boolean(draft.promoUploadEnabled),
        retailRadioEnabled: Boolean(draft.retailRadioEnabled),
        schoolRadioEnabled: Boolean(draft.schoolRadioEnabled),
        onlineRadioEnabled: Boolean(draft.onlineRadioEnabled),
        healthRadioEnabled: Boolean(draft.healthRadioEnabled),
        faithRadioEnabled: Boolean(draft.faithRadioEnabled),
        organisationsEnabled: Boolean(draft.organisationsEnabled),
        schoolPublicPublishingEnabled: Boolean(draft.schoolPublicPublishingEnabled),
        retailMediaEnabled: Boolean(draft.retailMediaEnabled),
        digitalSignageEnabled: Boolean(draft.digitalSignageEnabled),
        active: Boolean(draft.active)
      };
      const response = await fetch(`/api/admin/plans/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to update this tier.");
      const updated = { ...draft, ...body.plan, monthlyPrice: undefined };
      setPlans((current) => current.map((plan) => plan.id === updated.id ? updated : plan));
      setEditingId(null);
      setDraft(null);
      setStatus({ tone: "success", message: `${updated.name} was updated and the change was added to the audit log.` });
    } catch (saveError) {
      setStatus({ tone: "error", message: saveError instanceof Error ? saveError.message : "Unable to update this tier." });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className={styles.editor}>
      {status.message ? <p className={status.tone === "success" ? styles.success : styles.error} role="status">{status.message}</p> : null}
      <p className={styles.editorHint}>Choose <strong>Edit tier</strong> on any row. The action stays visible while the plan table scrolls.</p>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead><tr>{["Plan", "Product", "Tier", "Price / month", "Product access", "Licensed Music Catalogue", "Allowances", "Status", "Action"].map((label) => <th key={label} className={label === "Action" ? styles.actionHeader : undefined}>{label}</th>)}</tr></thead>
          <tbody>{plans.map((plan) => (
            <tr key={plan.id}>
              <td className={styles.planCell}><strong>{plan.name}</strong><code>{plan.code}</code>{plan.description ? <small>{plan.description}</small> : null}</td>
              <td>{productLabels[plan.productFamily] || "Unclassified"}</td>
              <td>Tier {plan.tierNumber}</td>
              <td className={styles.price}>{formatPrice(plan)}</td>
              <td><div className={styles.badges}>{productBadges(plan).map((label) => <span key={label}>{label}</span>)}</div></td>
              <td><span className={plan.licensedMusicCatalogueLevel === "NONE" ? styles.noneBadge : styles.catalogueBadge}>{plan.licensedMusicCatalogueLevel}</span></td>
              <td className={styles.allowances}>{plan.stationLimit} site/station{plan.stationLimit === 1 ? "" : "s"}<br />{plan.listenerLimit.toLocaleString()} listeners<br />{plan.storageLimitGb.toLocaleString()} GB · {plan.maxBitrateKbps} kbps{plan.digitalSignageEnabled ? <><br />Digital signage on</> : null}</td>
              <td><span className={plan.active ? styles.activeBadge : styles.inactiveBadge}>{plan.active ? "Active" : "Inactive"}</span></td>
              <td className={styles.actionCell}><button type="button" className={styles.editButton} onClick={() => beginEdit(plan)}>Edit tier</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {draft && editingId ? (
        <form ref={formRef} className={styles.form} onSubmit={save}>
          <div className={styles.formHeader}><div><p>Editing {draft.code}</p><h3>{draft.name}</h3></div><button type="button" onClick={() => { setEditingId(null); setDraft(null); setStatus({ tone: "", message: "" }); }}>Close</button></div>
          <p className={styles.formNotice}>Plan code and product family stay fixed. Saved changes affect every regular subscription using this tier; complimentary-access grants already activated retain their original snapshot.</p>
          <fieldset><legend>Plan and price</legend><div className={styles.fields}>
            <label>Plan name<input required minLength="2" maxLength="120" value={draft.name} onChange={(event) => updateField("name", event.target.value)} /></label>
            <label>Product<input value={productLabels[draft.productFamily] || draft.productFamily} disabled /></label>
            <label>Tier number<input type="number" min="1" max="5" required value={draft.tierNumber} onChange={(event) => updateField("tierNumber", event.target.value)} /></label>
            <label>Price per month (€)<input type="number" min="0" max="1000000" step="0.01" required value={draft.monthlyPrice} onChange={(event) => updateField("monthlyPrice", event.target.value)} /></label>
            <label className={styles.check}><input type="checkbox" checked={draft.active} onChange={(event) => updateField("active", event.target.checked)} />Tier is active</label>
          </div></fieldset>
          <fieldset><legend>Product access</legend><div className={styles.checkGrid}>{PRODUCT_FIELDS.map(([label, field]) => <label className={styles.check} key={field}><input type="checkbox" checked={draft[field]} onChange={(event) => updateField(field, event.target.checked)} />{label}</label>)}</div></fieldset>
          <fieldset><legend>Licensed Music Catalogue and tools</legend><div className={styles.fields}>
            <label>Catalogue<select value={draft.licensedMusicCatalogueLevel} onChange={(event) => updateField("licensedMusicCatalogueLevel", event.target.value)}><option value="NONE">None</option><option value="FOCUSED">Focused</option><option value="PROFESSIONAL">Professional</option><option value="PREMIUM">Premium</option></select></label>
          </div><div className={styles.checkGrid}>{EXTRA_FIELDS.map(([label, field]) => <label className={styles.check} key={field}><input type="checkbox" checked={draft[field]} onChange={(event) => updateField(field, event.target.checked)} />{label}</label>)}</div></fieldset>
          <fieldset><legend>Allowances</legend><div className={styles.fields}>
            <label>Sites / stations<input type="number" min="0" required value={draft.stationLimit} onChange={(event) => updateField("stationLimit", event.target.value)} /></label>
            <label>Media storage (GB)<input type="number" min="0" required value={draft.storageLimitGb} onChange={(event) => updateField("storageLimitGb", event.target.value)} /></label>
            <label>Active listeners<input type="number" min="0" required value={draft.listenerLimit} onChange={(event) => updateField("listenerLimit", event.target.value)} /></label>
            <label>Maximum bitrate (kbps)<input type="number" min="32" max="1024" required value={draft.maxBitrateKbps} onChange={(event) => updateField("maxBitrateKbps", event.target.value)} /></label>
            <label>External Studio destinations<input type="number" min="0" placeholder="No separate limit" value={draft.studioExternalDestinationLimit ?? ""} onChange={(event) => updateField("studioExternalDestinationLimit", event.target.value)} /></label>
          </div></fieldset>
          <div className={styles.formActions}><button className={styles.saveButton} disabled={working}>{working ? "Saving tier…" : "Save tier changes"}</button><button className={styles.cancelButton} type="button" disabled={working} onClick={() => { setEditingId(null); setDraft(null); }}>Cancel</button></div>
        </form>
      ) : null}
    </div>
  );
}
