import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import CorrectionsSetup from "./CorrectionsSetup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ruvanas Inside" };

export default async function CorrectionsDashboard() {
  await requireSubscriberProduct("CORRECTIONS");
  return <CorrectionsSetup />;
}
