import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import CorrectionsProgrammes from "./CorrectionsProgrammes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inside programmes & review" };

export default async function CorrectionsProgrammesPage() {
  await requireSubscriberProduct("CORRECTIONS");
  return <CorrectionsProgrammes />;
}
