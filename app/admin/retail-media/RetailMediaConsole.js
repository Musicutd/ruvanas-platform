"use client";

import { useEffect, useMemo, useState } from "react";

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const defaultDaypart = { weekday: 1, startMinute: 540, endMinute: 1020 };

function Badge({ value }) {
  const good = ["ACTIVE", "APPROVED"].includes(value);
  const bad = ["REJECTED", "CANCELLED", "ARCHIVED"].includes(value);
  return <span style={{ ...styles.badge, background: good ? "#dcfce7" : bad ? "#fee2e2" : "#fef3c7", color: good ? "#166534" : bad ? "#991b1b" : "#92400e" }}>{String(value).replaceAll("_", " ")}</span>;
}

export default function RetailMediaConsole({ organisations, canApprove = true, showOrganisationSelector = true }) {
  const firstEnabled = organisations.find((item) => item.retailMediaEnabled) || organisations[0];
  const [organisationId, setOrganisationId] = useState(firstEnabled?.id || "");
  const [partners, setPartners] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [orders, setOrders] = useState([]);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const [partner, setPartner] = useState({ kind: "ADVERTISER", name: "", contactName: "", contactEmail: "" });
  const [packageForm, setPackageForm] = useState({ name: "", description: "", priceModel: "CUSTOM", currencyCode: "", unitPriceMinor: "", maxPlays: 1000, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), restrictionNotes: "" });
  const [targets, setTargets] = useState([{ targetType: "LOCATION_GROUP", targetId: "" }]);
  const [dayparts, setDayparts] = useState([defaultDaypart]);
  const [orderForm, setOrderForm] = useState({ name: "", advertiserId: "", agencyId: "", inventoryPackageId: "", campaignId: "", creativePromoVersionId: "", visualAssetId: "", purchaseOrderReference: "" });
  const [fulfilmentSelections, setFulfilmentSelections] = useState({});
  const organisation = useMemo(() => organisations.find((item) => item.id === organisationId), [organisations, organisationId]);

  async function load() {
    if (!organisationId || !organisation?.retailMediaEnabled) { setPartners([]); setInventory([]); setOrders([]); return; }
    const query = `?organisationId=${encodeURIComponent(organisationId)}`;
    const responses = await Promise.all([fetch(`/api/admin/retail-media/partners${query}`, { cache: "no-store" }), fetch(`/api/admin/retail-media/inventory${query}`, { cache: "no-store" }), fetch(`/api/admin/retail-media/orders${query}`, { cache: "no-store" })]);
    const data = await Promise.all(responses.map((response) => response.json().then((body) => ({ response, body }))));
    const failure = data.find((item) => !item.response.ok);
    if (failure) throw new Error(failure.body.error || "Unable to load Retail Media.");
    setPartners(data[0].body.partners || []); setInventory(data[1].body.inventory || []); setOrders(data[2].body.orders || []);
  }
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [organisationId]);

  function targetOptions(type) {
    if (type === "BRAND") return organisation?.brands || [];
    if (type === "LOCATION_GROUP") return organisation?.locationGroups || [];
    return (organisation?.locations || []).flatMap((location) => location.zones.map((zone) => ({ id: zone.id, name: `${location.name} / ${zone.name}` })));
  }
  const promoVersions = (organisation?.promoAssets || []).flatMap((asset) => asset.versions.map((version) => ({ id: version.id, label: `${asset.name} · v${version.version}` })));
  const advertisers = partners.filter((item) => item.kind === "ADVERTISER" && item.status === "ACTIVE");
  const agencies = partners.filter((item) => item.kind === "AGENCY" && item.status === "ACTIVE");

  async function submit(path, body, success) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The operation could not be completed.");
      setMessage(success); await load(); return data;
    } catch (error) { setMessage(error.message); return null; }
    finally { setWorking(false); }
  }
  async function patch(path, body, success) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The operation could not be completed.");
      setMessage(success); await load();
    } catch (error) { setMessage(error.message); }
    finally { setWorking(false); }
  }

  if (!organisations.length) return <main style={styles.page}><h1>Retail Media</h1><p>Create an organisation before configuring Retail Media.</p></main>;
  return <main style={styles.page}>
    <p style={styles.eyebrow}>Stage 7D</p><h1 style={styles.title}>Retail Media orders</h1>
    <p style={styles.copy}>Build subscriber-approved advertiser inventory with audio and visual creative. Advertisers and agencies remain commercial records only; they cannot sign in or publish directly.</p>
    {showOrganisationSelector ? <label style={styles.label}>Organisation<select value={organisationId} onChange={(event) => setOrganisationId(event.target.value)} style={styles.input}>{organisations.map((item) => <option key={item.id} value={item.id}>{item.name}{item.retailMediaEnabled ? "" : " · disabled"}</option>)}</select></label> : <p style={styles.organisationName}>{organisation?.name}</p>}
    {!organisation?.retailMediaEnabled ? <div style={styles.warning}>Retail Media is disabled for this organisation. Enable it from Organisations before creating commercial records.</div> : null}
    {!canApprove ? <div style={styles.notice}>You can prepare partners, inventory drafts, and campaign orders. An organisation owner or manager must activate inventory and record approval decisions.</div> : null}
    {message ? <div role="status" style={styles.message}>{message}</div> : null}

    <section style={styles.panel}><h2 style={styles.heading}>1. Advertisers and agencies</h2><div style={styles.grid}>
      <label style={styles.label}>Type<select value={partner.kind} onChange={(event) => setPartner({ ...partner, kind: event.target.value })} style={styles.input}><option value="ADVERTISER">Advertiser</option><option value="AGENCY">Agency</option></select></label>
      <label style={styles.label}>Name<input value={partner.name} onChange={(event) => setPartner({ ...partner, name: event.target.value })} style={styles.input} /></label>
      <label style={styles.label}>Contact name<input value={partner.contactName} onChange={(event) => setPartner({ ...partner, contactName: event.target.value })} style={styles.input} /></label>
      <label style={styles.label}>Contact email<input type="email" value={partner.contactEmail} onChange={(event) => setPartner({ ...partner, contactEmail: event.target.value })} style={styles.input} /></label>
    </div><button disabled={working || !organisation?.retailMediaEnabled} onClick={async () => { const result = await submit("/api/admin/retail-media/partners", { ...partner, organisationId }, "Partner created."); if (result) setPartner({ kind: "ADVERTISER", name: "", contactName: "", contactEmail: "" }); }} style={styles.primary}>Add partner</button>
    <div style={styles.cards}>{partners.map((item) => <article key={item.id} style={styles.card}><strong>{item.name}</strong><Badge value={item.kind} /><span style={styles.muted}>{item.contactName || "No contact"}{item.contactEmail ? ` · ${item.contactEmail}` : ""}</span></article>)}</div></section>

    <section style={styles.panel}><h2 style={styles.heading}>2. Inventory packages</h2><div style={styles.grid}>
      <label style={styles.label}>Package name<input value={packageForm.name} onChange={(event) => setPackageForm({ ...packageForm, name: event.target.value })} style={styles.input} /></label>
      <label style={styles.label}>Price model<select value={packageForm.priceModel} onChange={(event) => setPackageForm({ ...packageForm, priceModel: event.target.value })} style={styles.input}><option value="CUSTOM">Custom agreement</option><option value="FIXED_FEE">Fixed fee</option><option value="PER_PLAY">Per play</option><option value="CPM">CPM reference</option></select></label>
      {packageForm.priceModel !== "CUSTOM" ? <><label style={styles.label}>Currency<input maxLength={3} value={packageForm.currencyCode} onChange={(event) => setPackageForm({ ...packageForm, currencyCode: event.target.value.toUpperCase() })} style={styles.input} /></label><label style={styles.label}>Unit price (minor units)<input type="number" min="0" value={packageForm.unitPriceMinor} onChange={(event) => setPackageForm({ ...packageForm, unitPriceMinor: event.target.value })} style={styles.input} /></label></> : null}
      <label style={styles.label}>Maximum plays<input type="number" min="1" value={packageForm.maxPlays} onChange={(event) => setPackageForm({ ...packageForm, maxPlays: Number(event.target.value) })} style={styles.input} /></label>
      <label style={styles.label}>Start<input type="date" value={packageForm.effectiveFrom} onChange={(event) => setPackageForm({ ...packageForm, effectiveFrom: event.target.value })} style={styles.input} /></label>
      <label style={styles.label}>End<input type="date" value={packageForm.effectiveTo} onChange={(event) => setPackageForm({ ...packageForm, effectiveTo: event.target.value })} style={styles.input} /></label>
    </div><label style={styles.label}>Description<textarea value={packageForm.description} onChange={(event) => setPackageForm({ ...packageForm, description: event.target.value })} style={styles.textarea} /></label>
    <h3 style={styles.subheading}>Eligible targets</h3>{targets.map((target, index) => <div key={index} style={styles.row}><select value={target.targetType} onChange={(event) => setTargets((items) => items.map((item, current) => current === index ? { targetType: event.target.value, targetId: "" } : item))} style={styles.input}><option value="BRAND">Brand</option><option value="LOCATION_GROUP">Location group</option><option value="ZONE">Zone</option></select><select value={target.targetId} onChange={(event) => setTargets((items) => items.map((item, current) => current === index ? { ...item, targetId: event.target.value } : item))} style={styles.input}><option value="">Choose target</option>{targetOptions(target.targetType).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={targets.length === 1} onClick={() => setTargets((items) => items.filter((_, current) => current !== index))}>Remove</button></div>)}<button onClick={() => setTargets((items) => [...items, { targetType: "LOCATION_GROUP", targetId: "" }])} style={styles.secondary}>Add target</button>
    <h3 style={styles.subheading}>Dayparts</h3>{dayparts.map((daypart, index) => <div key={index} style={styles.row}><select value={daypart.weekday} onChange={(event) => setDayparts((items) => items.map((item, current) => current === index ? { ...item, weekday: Number(event.target.value) } : item))} style={styles.input}>{weekdays.map((day, value) => <option key={day} value={value}>{day}</option>)}</select><input aria-label="Start minute" type="time" value={`${String(Math.floor(daypart.startMinute / 60)).padStart(2, "0")}:${String(daypart.startMinute % 60).padStart(2, "0")}`} onChange={(event) => { const [h, m] = event.target.value.split(":").map(Number); setDayparts((items) => items.map((item, current) => current === index ? { ...item, startMinute: h * 60 + m } : item)); }} style={styles.input} /><input aria-label="End minute" type="time" value={`${String(Math.floor(daypart.endMinute / 60)).padStart(2, "0")}:${String(daypart.endMinute % 60).padStart(2, "0")}`} onChange={(event) => { const [h, m] = event.target.value.split(":").map(Number); setDayparts((items) => items.map((item, current) => current === index ? { ...item, endMinute: h * 60 + m } : item)); }} style={styles.input} /><button disabled={dayparts.length === 1} onClick={() => setDayparts((items) => items.filter((_, current) => current !== index))}>Remove</button></div>)}<button onClick={() => setDayparts((items) => [...items, defaultDaypart])} style={styles.secondary}>Add daypart</button>
    <div style={styles.actions}><button disabled={working || !organisation?.retailMediaEnabled} onClick={async () => { const result = await submit("/api/admin/retail-media/inventory", { ...packageForm, organisationId, targets, dayparts }, "Inventory package saved as a draft."); if (result) setPackageForm((current) => ({ ...current, name: "", description: "" })); }} style={styles.primary}>Save inventory draft</button></div>
    <div style={styles.cards}>{inventory.map((item) => <article key={item.id} style={styles.card}><div><strong>{item.name}</strong><div style={styles.muted}>{item.maxPlays.toLocaleString()} maximum plays · {item.targets.length} targets · {item.dayparts.length} dayparts</div></div><Badge value={item.status} />{item.status === "DRAFT" && canApprove ? <button disabled={working} onClick={() => patch(`/api/admin/retail-media/inventory/${item.id}/status`, { status: "ACTIVE" }, "Inventory package activated.")} style={styles.secondary}>Activate</button> : null}</article>)}</div></section>

    <section style={styles.panel}><h2 style={styles.heading}>3. Supplier campaign orders</h2><div style={styles.grid}>
      <label style={styles.label}>Order name<input value={orderForm.name} onChange={(event) => setOrderForm({ ...orderForm, name: event.target.value })} style={styles.input} /></label>
      <label style={styles.label}>Advertiser<select value={orderForm.advertiserId} onChange={(event) => setOrderForm({ ...orderForm, advertiserId: event.target.value })} style={styles.input}><option value="">Choose advertiser</option>{advertisers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label style={styles.label}>Agency (optional)<select value={orderForm.agencyId} onChange={(event) => setOrderForm({ ...orderForm, agencyId: event.target.value })} style={styles.input}><option value="">Direct advertiser</option>{agencies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label style={styles.label}>Active inventory<select value={orderForm.inventoryPackageId} onChange={(event) => setOrderForm({ ...orderForm, inventoryPackageId: event.target.value })} style={styles.input}><option value="">Choose inventory</option>{inventory.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label style={styles.label}>Audio creative (optional)<select value={orderForm.creativePromoVersionId} onChange={(event) => setOrderForm({ ...orderForm, creativePromoVersionId: event.target.value })} style={styles.input}><option value="">No audio creative</option>{promoVersions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label style={styles.label}>Visual creative (optional)<select value={orderForm.visualAssetId} onChange={(event) => setOrderForm({ ...orderForm, visualAssetId: event.target.value })} style={styles.input}><option value="">No visual creative</option>{(organisation?.digitalSignageAssets || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.kind}</option>)}</select></label>
      <label style={styles.label}>Campaign draft (optional)<select value={orderForm.campaignId} onChange={(event) => { const campaign = organisation?.campaigns.find((item) => item.id === event.target.value); setOrderForm({ ...orderForm, campaignId: event.target.value, ...(campaign ? { creativePromoVersionId: campaign.promoVersionId } : {}) }); }} style={styles.input}><option value="">No campaign linked yet</option>{(organisation?.campaigns || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div><button disabled={working || !organisation?.retailMediaEnabled} onClick={async () => { const result = await submit("/api/admin/retail-media/orders", { ...orderForm, organisationId, creativePromoVersionIds: orderForm.creativePromoVersionId ? [orderForm.creativePromoVersionId] : [], visualAssetIds: orderForm.visualAssetId ? [orderForm.visualAssetId] : [] }, "Order draft created. Submit it for subscriber approval when ready."); if (result) setOrderForm({ name: "", advertiserId: "", agencyId: "", inventoryPackageId: "", campaignId: "", creativePromoVersionId: "", visualAssetId: "", purchaseOrderReference: "" }); }} style={styles.primary}>Create order draft</button>
    <p style={styles.notice}>Audio and visual plays remain device-confirmed delivery events. They are not listeners, viewers, impressions, or proof that media caused an operational outcome.</p>
    <div style={styles.cards}>{orders.map((order) => <article key={order.id} style={styles.orderCard}><div><strong>{order.name}</strong><div style={styles.muted}>{order.advertiser.name} · {order.inventoryPackage.name}{order.agency ? ` · ${order.agency.name}` : ""}</div></div><Badge value={order.status} />
      {order.creatives.map((creative) => <div key={creative.id} style={styles.creative}><span>Audio · {creative.promoVersion.promoAsset.name} v{creative.promoVersion.version}</span><Badge value={creative.status} />{canApprove && order.status === "SUBMITTED" && creative.status === "PENDING" ? <><button disabled={working} onClick={() => patch(`/api/admin/retail-media/orders/${order.id}/review`, { action: "APPROVE_CREATIVE", creativeId: creative.id, creativeType: "AUDIO" }, "Audio creative approved.")} style={styles.secondary}>Approve creative</button><button disabled={working} onClick={() => patch(`/api/admin/retail-media/orders/${order.id}/review`, { action: "REJECT_CREATIVE", creativeId: creative.id, creativeType: "AUDIO" }, "Audio creative rejected.")}>Reject</button></> : null}</div>)}
      {order.visualCreatives.map((creative) => <div key={creative.id} style={styles.creative}><span>Visual · {creative.signageAsset.name} · {creative.signageAsset.kind}</span><Badge value={creative.status} />{canApprove && order.status === "SUBMITTED" && creative.status === "PENDING" ? <><button disabled={working} onClick={() => patch(`/api/admin/retail-media/orders/${order.id}/review`, { action: "APPROVE_CREATIVE", creativeId: creative.id, creativeType: "VISUAL" }, "Visual creative approved.")} style={styles.secondary}>Approve creative</button><button disabled={working} onClick={() => patch(`/api/admin/retail-media/orders/${order.id}/review`, { action: "REJECT_CREATIVE", creativeId: creative.id, creativeType: "VISUAL" }, "Visual creative rejected.")}>Reject</button></> : null}</div>)}
      <div style={styles.actions}>{order.status === "DRAFT" ? <button disabled={working} onClick={() => patch(`/api/admin/retail-media/orders/${order.id}/review`, { action: "SUBMIT_ORDER" }, "Order submitted for subscriber approval.")} style={styles.primary}>Submit for approval</button> : null}{canApprove && order.status === "SUBMITTED" ? <><button disabled={working || [...order.creatives, ...order.visualCreatives].some((item) => item.status !== "APPROVED")} onClick={() => patch(`/api/admin/retail-media/orders/${order.id}/review`, { action: "APPROVE_ORDER" }, "Subscriber approval recorded. Existing publication checks still apply.")} style={styles.primary}>Approve order</button><button disabled={working} onClick={() => patch(`/api/admin/retail-media/orders/${order.id}/review`, { action: "REJECT_ORDER" }, "Order rejected.")}>Reject order</button></> : null}</div>
      {order.status === "APPROVED" && order.visualCreatives.length ? <div style={styles.creative}><select value={fulfilmentSelections[order.id] || order.visualPlaylists[0]?.id || ""} onChange={(event) => setFulfilmentSelections((current) => ({ ...current, [order.id]: event.target.value }))} style={styles.input}><option value="">Choose published visual playlist</option>{(organisation?.digitalSignagePlaylists || []).filter((playlist) => !playlist.retailMediaOrderId || playlist.retailMediaOrderId === order.id).map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select><button disabled={working || !(fulfilmentSelections[order.id] || order.visualPlaylists[0]?.id)} onClick={() => patch(`/api/admin/retail-media/orders/${order.id}/visual-fulfilment`, { action: "LINK", playlistId: fulfilmentSelections[order.id] || order.visualPlaylists[0]?.id }, "Approved visual order linked to its targeted playlist.")} style={styles.secondary}>Link visual fulfilment</button></div> : null}
    </article>)}</div></section>
  </main>;
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "40px 20px 80px", color: "#172033" },
  eyebrow: { margin: 0, color: "#9a6400", fontWeight: 900, letterSpacing: 1, textTransform: "uppercase" },
  title: { margin: "7px 0", fontSize: 38 },
  copy: { maxWidth: 850, color: "#475569", lineHeight: 1.6 },
  organisationName: { margin: "16px 0 0", fontSize: 18, fontWeight: 900 },
  panel: { marginTop: 24, padding: 24, border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc" },
  heading: { marginTop: 0, fontSize: 21 }, subheading: { margin: "22px 0 10px", fontSize: 15 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginBottom: 14 },
  row: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 10, alignItems: "end" },
  label: { display: "grid", gap: 6, marginTop: 12, color: "#334155", fontSize: 13, fontWeight: 800 },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 11px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff" },
  textarea: { minHeight: 76, padding: 10, border: "1px solid #94a3b8", borderRadius: 7 },
  primary: { padding: "10px 14px", border: 0, borderRadius: 7, background: "#f4b942", color: "#172033", fontWeight: 900, cursor: "pointer" },
  secondary: { padding: "9px 12px", border: "1px solid #94a3b8", borderRadius: 7, background: "#fff", fontWeight: 800, cursor: "pointer" },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 },
  cards: { display: "grid", gap: 10, marginTop: 18 },
  card: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: 14, border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" },
  orderCard: { display: "grid", gap: 12, padding: 16, border: "1px solid #cbd5e1", borderRadius: 9, background: "#fff" },
  creative: { display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", padding: 10, borderRadius: 7, background: "#f1f5f9" },
  badge: { display: "inline-block", padding: "4px 7px", borderRadius: 999, fontSize: 11, fontWeight: 900 },
  muted: { color: "#64748b", fontSize: 13, marginTop: 4 },
  message: { marginTop: 14, padding: 12, borderRadius: 8, background: "#e0f2fe", color: "#075985", fontWeight: 700 },
  warning: { marginTop: 16, padding: 14, border: "1px solid #f59e0b", borderRadius: 8, background: "#fffbeb", color: "#92400e", fontWeight: 800 },
  notice: { padding: 12, borderLeft: "4px solid #f4b942", background: "#fff", color: "#475569", fontSize: 13, lineHeight: 1.5 }
};
