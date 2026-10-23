import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { readPrivatePreviewPolicy, isPrivatePreviewTester } from "@/lib/private-preview-policy.mjs";
import { isPreviewOnlineDraftAccessMode, previewTesterAccessMode } from "@/lib/private-preview-account-policy.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { SUBSCRIBER_PRODUCT_LIST } from "@/lib/product-access.mjs";
import { prisma } from "@/lib/prisma";
import { resolveTestRadioSubscriberWorkspace } from "@/lib/test-radio-subscriber-access.mjs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your tester access | Ruvanas", robots: { index: false, follow: false } };
export default async function PreviewDashboard() {
  const context = await getActiveOrganisationContext({ subscription: { include: { plan: true, billingContract: true } }, enterpriseSecurityPolicy: true });
  const session = context?.session;
  if (!isPrivatePreviewTester(session?.user, readPrivatePreviewPolicy())) notFound();
  const access = session.user.privatePreviewAccess;
  const subscription = context.membership?.organisation?.subscription;
  const draftOnly = isPreviewOnlineDraftAccessMode(previewTesterAccessMode(subscription?.plan));
  const catalogueMetadata = draftOnly && resolveEntitlements(subscription).sandboxCatalogueMetadata === true;
  const testRadioWorkspace = await resolveTestRadioSubscriberWorkspace(prisma, context);
  return <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px", color: "#172033" }}>
    <p style={{ color: "#9a6400", fontWeight: 800 }}>RUVANAS · PRIVATE TESTER PREVIEW</p>
    <h1>Welcome, {session.user.name || session.user.email}</h1>
    <p>{testRadioWorkspace ? "Your Test Radio workspace includes the existing rights-filtered catalogue, Generate Playlist, Template Builder, Load Playlist and weekly drafts. Saved work is available to the administrator for review; only the administrator can approve a week for broadcast. Your drafts do not start, stop or change the current AutoDJ broadcast. Uploads, downloads, account creation and paid actions remain blocked."
      : catalogueMetadata ? "Your administrator has enabled private Online Radio drafts and rights-filtered FOCUSED catalogue metadata for Malta. Browse approved track details, save private playlist settings and preview your weekly plan. Live broadcasting, uploads, downloads, audio playback, public publishing, account creation and paid actions are blocked. No audio storage or streaming service is provisioned."
      : draftOnly ? "Your administrator has enabled editable Online Radio drafts in your own separate test workspace. You can save a station, playlists and weekly planner drafts. Live broadcasting, uploads, downloads, account creation and paid actions are blocked."
      : "Your administrator has given you read-only access to the pillars below, in your own separate sandbox. Editing, public publishing, uploads, downloads, account creation and paid actions are unavailable."}</p>
    <p>Access expires {access.expiresAt.toLocaleDateString("en-GB", { timeZone: "Europe/Malta" })}. Contact the administrator to change your access.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 20, margin: "28px 0" }}>
      {SUBSCRIBER_PRODUCT_LIST.filter(({ key }) => access.pillars.includes(key)).map((product) =>
        <section key={product.key} style={{ border: "1px solid #a9b7c9", padding: 24, borderRadius: 12 }}>
          <h2>{product.label}</h2><p>{product.description}</p><Link href={product.href}>Open pillar</Link>
        </section>)}
    </div>
    <form method="post" action="/api/auth/logout"><button type="submit">Sign out</button></form>
  </main>;
}
