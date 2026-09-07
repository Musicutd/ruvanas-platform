import { requireSubscriberProduct } from "@/lib/subscriber-product-access";

export default async function SchoolRadioProductLayout({ children }) {
  await requireSubscriberProduct("SCHOOL");
  return children;
}
