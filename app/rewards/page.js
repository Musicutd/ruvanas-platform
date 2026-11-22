import { notFound } from "next/navigation";
import { readShopperFeaturePolicy } from "@/lib/retail-rewards/shopper-contracts.mjs";
import { readShopperAuthPolicy } from "@/lib/retail-rewards/shopper-auth-contracts.mjs";
import { readCheckoutPolicy } from "@/lib/retail-rewards/checkout-contracts.mjs";
import ConnectedShopperDashboard from "./ConnectedShopperDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ruvanas Rewards · Shopper", robots: { index: false, follow: false } };

export default async function ShopperRewardsPage() {
  if (!readShopperFeaturePolicy(process.env).enabled) notFound();
  const { loadShopperDiscoveryPage } = await import("@/lib/retail-rewards/shopper-server");
  const result = await loadShopperDiscoveryPage();
  const authEnabled = readShopperAuthPolicy(process.env).enabled;
  if (!result.ok) return <main style={{ maxWidth: 680, margin: "48px auto", padding: 24 }}>
    <p>RUVANAS REWARDS · SHOPPER</p><h1>Shopper access is not available</h1>
    <p>This area requires separate shopper access. A business or administrator login does not open it.</p>
    <p>Public shopper registration remains closed.</p>
    {result.code === "RATE_LIMITED" && <p>Please wait a minute before refreshing this page.</p>}
    {authEnabled && <p><a href="/rewards/sign-in">Sign in with private shopper access</a></p>}
  </main>;
  return <ConnectedShopperDashboard initialData={JSON.parse(JSON.stringify(result))} enableSignOut={authEnabled} enableClaims={readCheckoutPolicy(process.env).enabled} />;
}
