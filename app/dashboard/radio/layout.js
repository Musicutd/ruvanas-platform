import { requireSubscriberProduct } from "@/lib/subscriber-product-access";

export default async function OnlineRadioProductLayout({ children }) {
  await requireSubscriberProduct("ONLINE");
  return children;
}
