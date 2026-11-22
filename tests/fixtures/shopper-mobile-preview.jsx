import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import ShopperDiscoveryClient from "../../app/rewards/ShopperDiscoveryClient";
import ShopperClaimsClient from "../../app/rewards/ShopperClaimsClient";
import ShopperSavingsClient from "../../app/rewards/ShopperSavingsClient";
import { createShopperMobilePreview } from "./shopper-mobile-preview.mjs";

let fixture = createShopperMobilePreview();
function App() {
  const [screen, setScreen] = useState("explore"), [revision, setRevision] = useState(0), [notice, setNotice] = useState("");
  window.shopperPreview = { get fixture() { return fixture; }, reset() { fixture = createShopperMobilePreview(); window.history.replaceState(null, "", window.location.pathname); setScreen("explore"); setNotice(""); setRevision(value => value + 1); },
    redeemLatest() { const result = fixture.redeemLatest(); setNotice(result ? "Sample cashier redemption recorded in this tab only. Refresh or reopen the offer to see one fewer use." : "Open a sample voucher and get its coupon first."); return result; },
    reverseLatest() { const result = fixture.reverseLatest(); setNotice(result ? "Sample correction recorded in this tab only. Refresh vouchers to see the restored offer allowance. The old code stays used." : "Simulate a cashier redemption first."); return result; },
    loadSampleWallet() { fixture.loadSampleWallet(); setScreen("wallet"); setRevision(value => value + 1); setNotice("Loaded fictional wallet examples in this tab: reusable, single-use, exhausted, expired, corrected and unavailable. This is an interface demonstration, not a live checkout test."); },
    toggleUsage() { fixture.state.missingUsage = !fixture.state.missingUsage; setRevision(value => value + 1); setNotice(fixture.state.missingUsage ? "Sample usage counts are unavailable. Published limits remain visible; no remaining count should be invented." : "Sample usage counts are available again."); },
    savingsScenario(mode) { if (!["positive", "unavailable", "negative", "zero", "unknown", "multiple", "empty"].includes(mode)) throw new Error("Unknown sample savings scenario"); fixture.state.savingsMode = mode; setScreen("savings"); setRevision(value => value + 1); setNotice("Fictional savings example only. No subscription payment or live account was read or changed."); },
    failSavingsRefresh() { fixture.state.failNext = true; setNotice("The next in-memory request will fail. Refresh savings to check recovery."); }
  };
  const browse = () => { window.history.replaceState(null, "", window.location.pathname); setScreen("explore"); setRevision(value => value + 1); };
  const account = () => { window.history.replaceState(null, "", `${window.location.pathname}#account`); setScreen("explore"); setRevision(value => value + 1); };
  return <>
    {screen === "savings" ? <ShopperSavingsClient key={`savings-${revision}`} initialData={fixture.initialSavings()} transport={fixture.transport} previewOnly onBrowse={browse} onWallet={() => setScreen("wallet")} onAccount={account} />
      : screen === "wallet"
      ? <ShopperClaimsClient key={`wallet-${revision}`} initialData={fixture.initialWallet()} transport={fixture.transport} previewOnly onBrowse={browse} onSavings={() => setScreen("savings")} onAccount={account} />
      : <ShopperDiscoveryClient key={`explore-${revision}`} initialData={fixture.initialData} transport={fixture.transport} previewOnly enableClaims onOpenWallet={() => setScreen("wallet")} onOpenSavings={() => setScreen("savings")} />}
    <aside className="preview-controls" aria-label="Local preview controls"><details><summary>Preview controls</summary><p>These controls simulate the shop's confirmation in this browser tab. They are not part of the shopper app.</p>
      <button type="button" onClick={() => window.shopperPreview.loadSampleWallet()}>Load sample wallet</button>
      <button type="button" onClick={() => window.shopperPreview.redeemLatest()}>Simulate cashier redemption</button>
      <button type="button" onClick={() => window.shopperPreview.reverseLatest()}>Simulate correction</button>
      <button type="button" onClick={() => window.shopperPreview.toggleUsage()}>Toggle sample usage counts</button>
      <button type="button" onClick={() => window.shopperPreview.savingsScenario("positive")}>Savings: €15 paid, €25 saved</button>
      <button type="button" onClick={() => window.shopperPreview.savingsScenario("unavailable")}>Savings: payments unavailable</button>
      <button type="button" onClick={() => window.shopperPreview.savingsScenario("negative")}>Savings: subscription not covered</button>
      <button type="button" onClick={() => window.shopperPreview.savingsScenario("zero")}>Savings: subscription covered</button>
      <button type="button" onClick={() => window.shopperPreview.savingsScenario("unknown")}>Savings: unvalued offer</button>
      <button type="button" onClick={() => window.shopperPreview.savingsScenario("multiple")}>Savings: separate currencies</button>
      <button type="button" onClick={() => window.shopperPreview.savingsScenario("empty")}>Savings: no recorded activity</button>
      <button type="button" onClick={() => window.shopperPreview.failSavingsRefresh()}>Fail next sample request</button>
      <button type="button" onClick={() => window.shopperPreview.reset()}>Reset demo</button>
      {notice && <p role="status">{notice}</p>}</details></aside>
  </>;
}
createRoot(document.getElementById("root")).render(<App />);
