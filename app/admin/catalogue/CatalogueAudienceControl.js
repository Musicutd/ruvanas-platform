"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CATALOGUE_PILLARS, CATALOGUE_TIERS, catalogueAudienceTier } from "@/lib/catalogue-audience.mjs";
import { CATALOGUE_TERRITORY_PRESETS, normalizeCatalogueTerritory } from "@/lib/catalogue-territories.mjs";

const presetCodes = new Set(CATALOGUE_TERRITORY_PRESETS.map((item) => item.code));
function territoryChoices(value) {
  const codes = String(value || "").split(/[,;\n]/).map(normalizeCatalogueTerritory).filter(Boolean);
  return { regions: codes.filter((code) => presetCodes.has(code)), extra: codes.filter((code) => !presetCodes.has(code)).join(", ") };
}

export default function CatalogueAudienceControl({ track, busy = false }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [tier, setTier] = useState(catalogueAudienceTier(track));
  const [uses, setUses] = useState(track.permittedUses || []);
  const [regions, setRegions] = useState(() => territoryChoices(track.permittedTerritories).regions);
  const [extraTerritories, setExtraTerritories] = useState(() => territoryChoices(track.permittedTerritories).extra);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setTier(catalogueAudienceTier(track));
    setUses(track.permittedUses || []);
    setRegions(territoryChoices(track.permittedTerritories).regions);
    setExtraTerritories(territoryChoices(track.permittedTerritories).extra);
    setConfirmed(false);
  }, [track.minimumCatalogueLevel, track.catalogueAllTiers, track.permittedUses, track.permittedTerritories]);
  const tierLabel = CATALOGUE_TIERS.find((item) => item.level === catalogueAudienceTier(track))?.label || "Legacy · treated as Tier 3";
  const pillarNames = CATALOGUE_PILLARS.filter((item) => track.permittedUses?.includes(item.use)).map((item) => item.label);
  const territories = String(track.permittedTerritories || "").trim();
  const disabled = busy || saving;

  function toggleUse(use) {
    setUses((current) => current.includes(use) ? current.filter((item) => item !== use) : [...current, use]);
  }
  function toggleRegion(code) {
    setRegions((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  }

  async function save() {
    if (disabled) return;
    if (!uses.length) { setMessage("Choose at least one pillar."); return; }
    const selectedTerritories = [...regions, ...extraTerritories.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)];
    if (!selectedTerritories.length) { setMessage("Choose at least one contract-approved territory."); return; }
    if (!confirmed) { setMessage("Confirm that the licence covers this access before saving."); return; }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/catalogue/tracks/${track.id}/audience`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minimumCatalogueLevel: tier, permittedUses: uses, permittedTerritories: selectedTerritories, rightsConfirmed: true })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save catalogue access.");
      setEditing(false);
      setConfirmed(false);
      setMessage("Saved. Subscriber access now follows this pillar and tier selection.");
      router.refresh();
    } catch (error) {
      setMessage(error.message || "Could not save catalogue access.");
    } finally { setSaving(false); }
  }

  return <div style={{ minWidth: 200, display: "grid", gap: 7 }}>
    <strong>{tierLabel}</strong>
    <small>{pillarNames.length ? pillarNames.join(", ") : "No pillars approved · unavailable to subscribers"}</small>
    <small>Territories: {territories || "Not recorded · unavailable to subscribers"}</small>
    <button type="button" disabled={disabled} onClick={() => { setEditing((current) => !current); setMessage(""); }} style={buttonStyle}>{editing ? "Cancel" : "Edit access"}</button>
    {editing ? <div style={{ display: "grid", gap: 8, padding: 10, border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" }}>
      <label style={{ display: "grid", gap: 4 }}>Available from tier
        <select value={tier} onChange={(event) => setTier(event.target.value)} disabled={disabled} style={inputStyle}>{CATALOGUE_TIERS.map((item) => <option key={item.level} value={item.level}>{item.label}</option>)}</select>
      </label>
      <small>All tiers includes every plan with catalogue access. Product-use, territory, genre and licence rules still apply.</small>
      {CATALOGUE_PILLARS.map((pillar) => <label key={pillar.use} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={uses.includes(pillar.use)} onChange={() => toggleUse(pillar.use)} disabled={disabled} />{pillar.label}</label>)}
      <fieldset style={{ border: "1px solid #cbd5e1", borderRadius: 6, display: "grid", gap: 6 }}>
        <legend>Contract-approved territories · required</legend>
        {CATALOGUE_TERRITORY_PRESETS.map((region) => <label key={region.code} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={regions.includes(region.code)} onChange={() => toggleRegion(region.code)} disabled={disabled} />{region.label}</label>)}
        <label style={{ display: "grid", gap: 4 }}>Other approved country codes
          <input value={extraTerritories} onChange={(event) => setExtraTerritories(event.target.value)} disabled={disabled} placeholder="MT, GB, or WORLDWIDE only if licensed" style={inputStyle} />
        </label>
      </fieldset>
      <small>Changes to a ready track can immediately change subscriber availability. Provider territories cannot be widened here; other rights and genre controls still apply.</small>
      <label style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={disabled} />I confirm the recorded licence covers these pillars and this tier.</label>
      <button type="button" onClick={save} disabled={disabled || !uses.length || (!regions.length && !extraTerritories.trim()) || !confirmed} style={buttonStyle}>{saving ? "Saving…" : "Save access"}</button>
    </div> : null}
    {message ? <small role="status">{message}</small> : null}
  </div>;
}

const buttonStyle = { border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", color: "#172033", padding: "6px 9px", fontWeight: 800, cursor: "pointer" };
const inputStyle = { padding: "7px 8px", border: "1px solid #94a3b8", borderRadius: 6, background: "#fff", color: "#172033" };
