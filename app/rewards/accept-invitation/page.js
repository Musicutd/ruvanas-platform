import { notFound } from "next/navigation";
import { readShopperAuthPolicy } from "@/lib/retail-rewards/shopper-auth-contracts.mjs";
import ShopperAuthClient from "../ShopperAuthClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept shopper invitation · Ruvanas Rewards", robots: { index: false, follow: false } };

export default function ShopperInvitationPage() {
  if (!readShopperAuthPolicy(process.env).enabled) notFound();
  return <ShopperAuthClient mode="invitation" />;
}
