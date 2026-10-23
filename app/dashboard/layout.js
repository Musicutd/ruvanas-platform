import { redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import { buildSubscriberNavigation } from "@/lib/user-experience-navigation.mjs";
import { firstListenableOnlineStation, onlineRadioListenHref } from "@/lib/online-radio-listen.mjs";
import { pillarListenHref } from "@/lib/pillar-audio.mjs";
import { enabledSubscriberProducts } from "@/lib/product-access.mjs";
import SubscriberPortalShell from "./SubscriberPortalShell";
import { isPrivatePreviewTester, readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";
import { isPreviewOnlineDraftAccessMode, previewTesterAccessMode } from "@/lib/private-preview-account-policy.mjs";
import { prisma } from "@/lib/prisma";
import { resolveTestRadioSubscriberWorkspace } from "@/lib/test-radio-subscriber-access.mjs";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }) {
  const context = await getActiveOrganisationContext({
    subscription: { include: { plan: true, billingContract: true } },
    enterpriseSecurityPolicy: true,
    stations: { select: { id: true, status: true, productFamily: true, streamConfig: { select: { streamUrl: true } } }, orderBy: { createdAt: "asc" } },
    betaParticipations: {
      where: { status: "ACTIVE", programme: { status: "ACTIVE" } },
      select: { id: true },
      take: 1
    }
  });

  if (!context) redirect("/login");
  if (context.user.role === "STUDENT") redirect("/school-student");
  if (!context.membership) redirect("/register");

  const organisation = context.membership.organisation;
  const previewTester = isPrivatePreviewTester(context.user, readPrivatePreviewPolicy());
  const previewDraftOnly = previewTester && isPreviewOnlineDraftAccessMode(previewTesterAccessMode(organisation.subscription?.plan));
  const entitlements = resolveEntitlements(organisation.subscription);
  const previewCatalogueMetadata = previewDraftOnly && entitlements.sandboxCatalogueMetadata === true;
  const testRadioWorkspace = await resolveTestRadioSubscriberWorkspace(prisma, context);
  const firstStation = organisation.stations.find((station) => station.status === "ACTIVE")
    || organisation.stations[0]
    || null;
  const navigation = buildSubscriberNavigation({
    entitlements,
    firstStationId: firstStation?.id || null,
    betaActive: organisation.betaParticipations.length > 0
  });
  const listenStation = entitlements.serviceEnabled && entitlements.onlineRadioEnabled
    ? firstListenableOnlineStation(organisation.stations)
    : null;
  const listenHrefs = Object.fromEntries(enabledSubscriberProducts(entitlements).map((product) => [
    product.key,
    product.key === "ONLINE" && listenStation ? onlineRadioListenHref(listenStation.id) : pillarListenHref(product.key)
  ]));

  return (
    <SubscriberPortalShell
      navigation={navigation}
      organisationName={organisation.name}
      userName={context.user.name || context.user.email}
      membershipRole={context.membership.role}
      listenHrefs={listenHrefs}
    >
      {previewTester ? <aside style={{ padding: 16, background: "#fff5d6", color: "#172033", borderBottom: "1px solid #d5b66b" }}>
        {testRadioWorkspace ? "Test Radio planning workspace: browse approved catalogue details and save playlists, templates and weekly drafts. Your drafts do not change the current broadcast. On-air approval and streaming settings stay admin-only; uploads, downloads and public registration remain closed. "
          : previewCatalogueMetadata ? "Editable Online Radio test workspace with Malta catalogue metadata. Browse rights-filtered FOCUSED track details for Malta and save private drafts. Live broadcasting, uploads, downloads, audio playback, publishing, paid actions and public registration are blocked. "
          : previewDraftOnly ? "Editable Online Radio test workspace. Save station, playlist and weekly planner drafts only. Live broadcasting, uploads, downloads, paid actions and public registration are blocked. "
          : "Read-only tester sandbox. Editing, uploads, downloads and publishing are unavailable. "}<a href="/preview-dashboard">Your assigned pillars</a>
      </aside> : null}
      {children}
    </SubscriberPortalShell>
  );
}
