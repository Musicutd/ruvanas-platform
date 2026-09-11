"use client";

import { useState } from "react";

export default function GenreTierControl({ genre }) {
  const [level, setLevel] = useState(genre.fixedCatalogueLevel || genre.minimumCatalogueLevel);
  const [state, setState] = useState("");
  async function change(event) {
    const next = event.target.value; setLevel(next); setState("Saving…");
    const response = await fetch(`/api/admin/catalogue/genres/${genre.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minimumCatalogueLevel: next }) });
    const payload = await response.json(); setState(response.ok ? "Saved" : payload.error || "Unable to save");
  }
  return <label style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12, fontWeight: 800 }}>Licensed catalogue tier<select value={level} onChange={change} disabled={Boolean(genre.fixedCatalogueLevel)} style={{ minHeight: 38, borderRadius: 8, padding: "6px 9px" }}><option value="FOCUSED">Tier 3 / Focused</option><option value="PROFESSIONAL">Tier 4 / Professional</option><option value="PREMIUM">Tier 5 / Premium more</option></select>{genre.fixedCatalogueLevel ? <small>Fixed by the AutoDJ entitlement matrix.</small> : state ? <small>{state}</small> : null}</label>;
}
