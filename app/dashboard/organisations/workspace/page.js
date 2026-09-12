import { requireSubscriberProduct } from "@/lib/subscriber-product-access";
import OrganisationsWorkspace from "./OrganisationsWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organisations workspace | Ruvanas" };

export default async function OrganisationsWorkspacePage() {
  await requireSubscriberProduct("ORGANISATIONS");
  return <OrganisationsWorkspace />;
}
