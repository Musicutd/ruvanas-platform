import { requireSubscriberProduct } from "@/lib/subscriber-product-access";

export default async function OnlineStationManagementLayout({ children }) {
  await requireSubscriberProduct("ONLINE");
  return children;
}
