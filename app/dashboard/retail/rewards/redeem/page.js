import { notFound } from "next/navigation";
import { readCheckoutPolicy } from "@/lib/retail-rewards/checkout-contracts.mjs";
import CheckoutClient from "./CheckoutClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shop checkout · Ruvanas Rewards", robots: { index: false, follow: false } };

export default async function RewardsCheckoutPage() {
  if (!readCheckoutPolicy(process.env).enabled) notFound();
  const { loadStaffCheckoutPage } = await import("@/lib/retail-rewards/checkout-server");
  const result = await loadStaffCheckoutPage();
  return <CheckoutClient initialData={JSON.parse(JSON.stringify(result))} />;
}
