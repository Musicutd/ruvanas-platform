import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import CorrectionsDevelopment from "./CorrectionsDevelopment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inside contributor development" };
export default async function CorrectionsContributorsPage() {
  await requireSubscriberProduct("CORRECTIONS");
  return <CorrectionsDevelopment />;
}
