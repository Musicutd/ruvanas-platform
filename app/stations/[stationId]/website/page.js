import { notFound, redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { stationDomainDnsName, stationDomainDnsValue } from "@/lib/station-website.mjs";
import StationWebsiteSettings from "./StationWebsiteSettings";
import { subscriberProductForStationFamily } from "@/lib/product-access.mjs";
import { requireSubscriberProduct } from "@/lib/subscriber-product-access";

export const dynamic = "force-dynamic";
export const metadata = { title: "Station website | Ruvanas" };

export default async function StationWebsiteSettingsPage({ params }) {
  const context = await getActiveOrganisationContext();
  if (!context?.membership) redirect("/login");
  const station = await prisma.station.findFirst({
    where: { id: String(params.stationId || ""), organisationId: context.membership.organisationId },
    select: {
      id: true, name: true, slug: true, productFamily: true, stationWebsiteEnabled: true, stationWebsiteHeadline: true,
      stationWebsiteAbout: true, stationWebsiteHeroImageUrl: true, stationWebsiteContactEmail: true,
      stationWebsiteTheme: true, stationWebsiteLinks: true, stationWebsiteShowNowPlaying: true,
      stationWebsiteShowPodcasts: true,
      websiteDomains: { orderBy: { createdAt: "asc" }, select: { id: true, hostname: true, status: true, verificationToken: true, lastCheckedAt: true, verifiedAt: true, activatedAt: true } }
    }
  });
  if (!station) notFound();
  const productKey = subscriberProductForStationFamily(station.productFamily);
  await requireSubscriberProduct(productKey);
  const productLabel = productKey === "HEALTH" ? "RUVANAS HEALTH" : productKey === "FAITH" ? "RUVANAS FAITH" : "ONLINE RADIO";
  const canManage = ["OWNER", "MANAGER"].includes(context.membership.role);
  const safeStation = { ...station, websiteDomains: station.websiteDomains.map((domain) => ({ ...domain, dnsName: stationDomainDnsName(domain.hostname), dnsValue: stationDomainDnsValue(domain.verificationToken) })) };
  return <main style={styles.page}><section style={styles.shell}>
    <a href={`/stations/${station.id}`} style={styles.back}>← Back to station</a>
    <p style={styles.eyebrow}>{productLabel}</p>
    <h1 style={styles.title}>Station website</h1>
    <p style={styles.copy}>Give listeners a polished public home for live radio, now-playing information, station stories and published podcasts—with optional verified custom-domain routing.</p>
    <StationWebsiteSettings station={safeStation} canManage={canManage} />
  </section></main>;
}

const styles = { page: { minHeight: "100vh", background: "#0b1322", color: "#f8fafc", fontFamily: "Arial, sans-serif", padding: "48px 20px" }, shell: { width: "min(1180px, 100%)", margin: "0 auto" }, back: { color: "#cbd5e1", textDecoration: "none" }, eyebrow: { color: "#f4b942", letterSpacing: 1.5, fontWeight: 900, fontSize: 12, marginTop: 42 }, title: { fontSize: "clamp(40px, 7vw, 68px)", margin: "8px 0 14px" }, copy: { color: "#bac6d8", lineHeight: 1.65, fontSize: 18, maxWidth: 760 } };
