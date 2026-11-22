import { notFound } from "next/navigation";
import { readShopperFeaturePolicy } from "@/lib/retail-rewards/shopper-contracts.mjs";
import ShopperSavingsClient from "../ShopperSavingsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "My savings · Ruvanas Rewards", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ShopperSavingsPage() {
  if (!readShopperFeaturePolicy(process.env).enabled) notFound();
  const { loadShopperSavingsPage } = await import("@/lib/retail-rewards/shopper-savings-server");
  const result = await loadShopperSavingsPage();
  return <ShopperSavingsClient initialData={JSON.parse(JSON.stringify(result))} />;
}
