import { notFound } from "next/navigation";
import { readCheckoutPolicy } from "@/lib/retail-rewards/checkout-contracts.mjs";
import ShopperClaimsClient from "../ShopperClaimsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your coupons · Ruvanas Rewards", robots: { index: false, follow: false } };

export default async function ShopperWalletPage() {
  if (!readCheckoutPolicy(process.env).enabled) notFound();
  const { loadShopperWalletPage } = await import("@/lib/retail-rewards/checkout-server");
  const result = await loadShopperWalletPage();
  return <ShopperClaimsClient initialData={JSON.parse(JSON.stringify(result))} />;
}
