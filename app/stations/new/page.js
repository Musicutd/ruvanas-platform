import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { isPrivatePreviewTester, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { previewTesterAccessMode } from "@/lib/private-preview-account-policy.mjs";
import NewStationClient from "./NewStationClient";

export const dynamic = "force-dynamic";

export default async function NewStationPage() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true } } });
  if (!context) redirect("/login");
  const tester = isPrivatePreviewTester(context.user, readPrivatePreviewPolicy());
  const previewAccessMode = tester
    ? previewTesterAccessMode(context.membership?.organisation?.subscription?.plan) || "READ_ONLY"
    : null;
  return <NewStationClient previewAccessMode={previewAccessMode} />;
}
