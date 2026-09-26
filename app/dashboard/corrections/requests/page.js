import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import CorrectionsRequests from "./CorrectionsRequests";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inside requests" };

export default async function CorrectionsRequestsPage() {
  await requireSubscriberProduct("CORRECTIONS");
  return <CorrectionsRequests />;
}
