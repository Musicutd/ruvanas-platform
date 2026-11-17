import { notFound } from "next/navigation";
import { readShopperAuthPolicy } from "@/lib/retail-rewards/shopper-auth-contracts.mjs";
import ShopperAuthClient from "../ShopperAuthClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shopper sign-in · Ruvanas Rewards", robots: { index: false, follow: false } };

export default function ShopperSignInPage() {
  if (!readShopperAuthPolicy(process.env).enabled) notFound();
  return <ShopperAuthClient mode="login" />;
}
