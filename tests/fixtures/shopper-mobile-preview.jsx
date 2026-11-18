import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ShopperDiscoveryClient from "../../app/rewards/ShopperDiscoveryClient";
import ShopperClaimsClient from "../../app/rewards/ShopperClaimsClient";
import { createShopperMobilePreview } from "./shopper-mobile-preview.mjs";

let fixture = createShopperMobilePreview();
function App() {
  const [screen, setScreen] = useState("explore"), [revision, setRevision] = useState(0), [notice, setNotice] = useState("");
  window.shopperPreview = { get fixture() { return fixture; }, reset() { fixture = createShopperMobilePreview(); window.history.replaceState(null, "", window.location.pathname); setScreen("explore"); setNotice(""); setRevision(value => value + 1); },
    redeemLatest() { const result = fixture.redeemLatest(); setNotice(result ? "Sample cashier redemption recorded in this tab only. Refresh or reopen the offer to see one fewer use." : "Open a sample voucher and get its coupon first."); return result; },
    reverseLatest() { const result = fixture.reverseLatest(); setNotice(result ? "Sample correction recorded in this tab only. Refresh vouchers to see the restored offer allowance. The old code stays used." : "Simulate a cashier redemption first."); return result; },
    loadSampleWallet() { fixture.loadSampleWallet(); setScreen("wallet"); setRevision(value => value + 1); setNotice("Loaded fictional wallet examples in this tab: reusable, single-use, exhausted, expired, corrected and unavailable. This is an interface demonstration, not a live checkout test."); },
    toggleUsage() { fixture.state.missingUsage = !fixture.state.missingUsage; setRevision(value => value + 1); setNotice(fixture.state.missingUsage ? "Sample usage counts are unavailable. Published limits remain visible; no remaining count should be invented." : "Sample usage counts are available again."); }
  };
  const browse = () => { window.history.replaceState(null, "", window.location.pathname); setScreen("explore"); setRevision(value => value + 1); };
  const account = () => { window.history.replaceState(null, "", `${window.location.pathname}#account`); setScreen("explore"); setRevision(value => value + 1); };
  return <>
    {screen === "wallet"
      ? <ShopperClaimsClient key={`wallet-${revision}`} initialData={fixture.initialWallet()} transport={fixture.transport} previewOnly onBrowse={browse} onAccount={account} />
      : <ShopperDiscoveryClient key={`explore-${revision}`} initialData={fixture.initialData} transport={fixture.transport} previewOnly enableClaims onOpenWallet={() => setScreen("wallet")} />}
    <aside className="preview-controls" aria-label="Local preview controls"><details><summary>Preview controls</summary><p>These controls simulate the shop's confirmation in this browser tab. They are not part of the shopper app.</p>
      <button type="button" onClick={() => window.shopperPreview.loadSampleWallet()}>Load sample wallet</button>
      <button type="button" onClick={() => window.shopperPreview.redeemLatest()}>Simulate cashier redemption</button>
      <button type="button" onClick={() => window.shopperPreview.reverseLatest()}>Simulate correction</button>
      <button type="button" onClick={() => window.shopperPreview.toggleUsage()}>Toggle sample usage counts</button>
      <button type="button" onClick={() => window.shopperPreview.reset()}>Reset demo</button>
      {notice && <p role="status">{notice}</p>}</details></aside>
  </>;
}
createRoot(document.getElementById("root")).render(<App />);
