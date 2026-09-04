import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import SchoolRadioEntitlementControl from "./SchoolRadioEntitlementControl";
import SchoolPublicPublishingEntitlementControl from "./SchoolPublicPublishingEntitlementControl";
import RetailMediaEntitlementControl from "./RetailMediaEntitlementControl";
import DigitalSignageEntitlementControl from "./DigitalSignageEntitlementControl";
import PageHeader from "@/app/components/PageHeader";
import EmptyState from "@/app/components/EmptyState";
import { interfaceMessages } from "@/lib/interface-guidance.mjs";
import { resolveEntitlements } from "@/lib/entitlements.mjs";
import {
  buildOnlineRadioProductOnboarding,
  buildRetailProductOnboarding,
  buildSchoolProductOnboarding
} from "@/lib/product-onboarding.mjs";

function ProductReadinessSummary({ organisation }) {
  const entitlements = resolveEntitlements(organisation.subscription);
  const firstStation = organisation.stations.find((station) => station.status === "ACTIVE") || organisation.stations[0] || null;
  const common = {
    serviceEnabled: entitlements.serviceEnabled,
    membershipRole: "OWNER",
    activePlayerStreams: organisation.playerListenerLeases.length
  };
  const products = [
    {
      label: "Retail",
      enabled: entitlements.serviceEnabled,
      readiness: buildRetailProductOnboarding({
        ...common,
        activeLocationCount: organisation.locations.length,
        activeMusicModeCount: organisation.musicModes.length,
        publishedScheduleCount: organisation.musicSchedules.length,
        configuredPlayerCount: organisation.players.length
      })
    },
    {
      label: "School",
      enabled: entitlements.schoolRadioEnabled,
      readiness: buildSchoolProductOnboarding({
        ...common,
        serviceEnabled: entitlements.schoolRadioEnabled,
        schoolProfileReady: Boolean(organisation.schoolProfile),
        activeSupervisorCount: organisation.staffSupervisors.length,
        safeguardingStatus: organisation.schoolSafeguardingReadiness?.status || null,
        activeProgrammeCount: organisation.schoolProgrammes.length,
        approvedEpisodeCount: organisation.schoolEpisodes.length
      })
    },
    {
      label: "Online",
      enabled: entitlements.serviceEnabled,
      readiness: buildOnlineRadioProductOnboarding({
        ...common,
        firstStationId: firstStation?.id || null,
        stationActive: firstStation?.status === "ACTIVE",
        streamConfigured: Boolean(firstStation?.streamConfig?.streamUrl),
        activeMusicModeCount: organisation.musicModes.length,
        publishedScheduleCount: organisation.musicSchedules.length
      })
    }
  ];

  return (
    <div style={styles.readinessList} aria-label={`${organisation.name} product readiness`}>
      {products.map((product) => (
        <div key={product.label} style={styles.readinessRow}>
          <span style={styles.readinessLabel}>{product.label}</span>
          {product.enabled ? (
            <>
              <progress style={styles.readinessProgress} value={product.readiness.completedCount} max={product.readiness.totalCount} aria-label={`${product.label} ${product.readiness.percent}% ready`} />
              <strong style={product.readiness.complete ? styles.ready : styles.inProgress}>{product.readiness.percent}%</strong>
              <span style={styles.readinessNext}>{product.readiness.complete ? "Ready for operation" : `Next: ${product.readiness.nextAction.title}`}</span>
            </>
          ) : <span style={styles.notIncluded}>Not included</span>}
        </div>
      ))}
    </div>
  );
}

export default async function AdminOrganisationsPage() {
  const adminUser = await getAdminUser();
  const canManageEntitlements = adminUser?.role === "SUPER_ADMIN";
  const now = new Date();
  const organisations = await prisma.organisation.findMany({
    include: {
      subscription: {
        include: {
          plan: true,
          billingContract: true
        }
      },
      stations: { select: { id: true, status: true, streamConfig: { select: { streamUrl: true } } }, orderBy: { createdAt: "asc" } },
      locations: { where: { status: "ACTIVE" }, select: { id: true } },
      players: { where: { status: { not: "DISABLED" } }, select: { id: true } },
      musicModes: { where: { status: "ACTIVE" }, select: { id: true } },
      musicSchedules: { where: { status: "PUBLISHED" }, select: { id: true } },
      playerListenerLeases: { where: { revokedAt: null, expiresAt: { gt: now } }, select: { id: true } },
      schoolProfile: { select: { id: true } },
      schoolSafeguardingReadiness: { select: { status: true } },
      staffSupervisors: { where: { active: true }, select: { id: true } },
      schoolProgrammes: { where: { status: "ACTIVE" }, select: { id: true } },
      schoolEpisodes: { where: { status: "APPROVED" }, select: { id: true } },
      _count: {
        select: {
          members: true,
          brands: true,
          locations: true,
          channels: true,
          stations: true
        }
      }
    },
    orderBy: {
      name: "asc"
    }
  });

  return (
    <main style={styles.page}>
      <PageHeader
        eyebrow="Platform management"
        title={interfaceMessages.organisations.title}
        description="Customer accounts contain their brands, locations, stations, channels and team members."
      >
        <Link href="/admin/organisations/new" style={styles.addButton}>
          Add organisation
        </Link>
      </PageHeader>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Existing organisations</h2>

        {organisations.length === 0 ? (
          <EmptyState
            title={interfaceMessages.organisations.emptyTitle}
            description={interfaceMessages.organisations.emptyDescription}
            actionHref="/admin/organisations/new"
            actionLabel="Add organisation"
          />
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th scope="col" style={styles.tableHeader}>Organisation</th>
                  <th scope="col" style={styles.tableHeader}>Plan</th>
                  <th scope="col" style={styles.tableHeader}>Subscription</th>
                  <th scope="col" style={styles.tableHeader}>Product readiness</th>
                  <th scope="col" style={styles.tableHeader}>School Radio</th>
                  <th scope="col" style={styles.tableHeader}>School Public Publishing</th>
                  <th scope="col" style={styles.tableHeader}>Retail Media</th>
                  <th scope="col" style={styles.tableHeader}>Digital Signage</th>
                  <th scope="col" style={styles.tableHeader}>Members</th>
                  <th scope="col" style={styles.tableHeader}>Brands</th>
                  <th scope="col" style={styles.tableHeader}>Locations</th>
                  <th scope="col" style={styles.tableHeader}>Channels</th>
                  <th scope="col" style={styles.tableHeader}>Stations</th>
                  <th scope="col" style={styles.tableHeader}>Created</th>
                </tr>
              </thead>

              <tbody>
                {organisations.map((organisation) => (
                  <tr key={organisation.id} style={styles.tableRow}>
                    <td style={styles.tableCellStrong}>
                      <div>{organisation.name}</div>
                      <div style={styles.slug}>{organisation.slug}</div>
                    </td>

                    <td style={styles.tableCell}>
                      {organisation.subscription?.plan?.name || "No plan"}
                    </td>

                    <td style={styles.tableCell}>
                      {organisation.subscription?.status || "No subscription"}
                    </td>

                    <td style={styles.tableCellReadiness}>
                      <ProductReadinessSummary organisation={organisation} />
                    </td>

                    <td style={styles.tableCellFeature}>
                      {organisation.subscription ? (
                        <SchoolRadioEntitlementControl
                          organisationId={organisation.id}
                          effectiveEnabled={Boolean(
                            organisation.subscription.schoolRadioEnabled ??
                            organisation.subscription.plan.schoolRadioEnabled
                          )}
                          overrideEnabled={organisation.subscription.schoolRadioEnabled}
                          planDefaultEnabled={organisation.subscription.plan.schoolRadioEnabled}
                          canManage={canManageEntitlements}
                        />
                      ) : (
                        <span style={styles.muted}>Unavailable</span>
                      )}
                    </td>

                    <td style={styles.tableCellFeature}>
                      {organisation.subscription ? (
                        <SchoolPublicPublishingEntitlementControl
                          organisationId={organisation.id}
                          effectiveEnabled={Boolean(
                            organisation.subscription.schoolPublicPublishingEnabled ??
                            organisation.subscription.plan.schoolPublicPublishingEnabled
                          )}
                          overrideEnabled={organisation.subscription.schoolPublicPublishingEnabled}
                          planDefaultEnabled={organisation.subscription.plan.schoolPublicPublishingEnabled}
                          canManage={canManageEntitlements}
                        />
                      ) : (
                        <span style={styles.muted}>Unavailable</span>
                      )}
                    </td>

                    <td style={styles.tableCellFeature}>
                      {organisation.subscription ? (
                        <RetailMediaEntitlementControl
                          organisationId={organisation.id}
                          effectiveEnabled={Boolean(
                            organisation.subscription.retailMediaEnabled ??
                            organisation.subscription.plan.retailMediaEnabled
                          )}
                          overrideEnabled={organisation.subscription.retailMediaEnabled}
                          planDefaultEnabled={organisation.subscription.plan.retailMediaEnabled}
                          canManage={canManageEntitlements}
                        />
                      ) : (
                        <span style={styles.muted}>Unavailable</span>
                      )}
                    </td>

                    <td style={styles.tableCellFeature}>
                      {organisation.subscription ? (
                        <DigitalSignageEntitlementControl
                          organisationId={organisation.id}
                          effectiveEnabled={Boolean(
                            organisation.subscription.digitalSignageEnabled ??
                            organisation.subscription.plan.digitalSignageEnabled
                          )}
                          overrideEnabled={organisation.subscription.digitalSignageEnabled}
                          planDefaultEnabled={organisation.subscription.plan.digitalSignageEnabled}
                          canManage={canManageEntitlements}
                        />
                      ) : (
                        <span style={styles.muted}>Unavailable</span>
                      )}
                    </td>

                    <td style={styles.tableCell}>
                      {organisation._count.members}
                    </td>

                    <td style={styles.tableCell}>
                      {organisation._count.brands}
                    </td>

                    <td style={styles.tableCell}>
                      {organisation._count.locations}
                    </td>

                    <td style={styles.tableCell}>
                      {organisation._count.channels}
                    </td>

                    <td style={styles.tableCell}>
                      {organisation._count.stations}
                    </td>

                    <td style={styles.tableCell}>
                      {new Date(
                        organisation.createdAt
                      ).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

const styles = {
  page: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "40px 16px 64px",
    color: "#172033"
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 28
  },
  eyebrow: {
    margin: "0 0 8px",
    color: "#9a6400",
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  title: {
    margin: 0,
    color: "#111827",
    fontSize: 32,
    fontWeight: 900
  },
  description: {
    maxWidth: 700,
    margin: "10px 0 0",
    color: "#475569",
    fontSize: 15,
    lineHeight: 1.55
  },
  addButton: {
    display: "inline-block",
    borderRadius: 7,
    background: "#f4b942",
    color: "#172033",
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 900,
    textDecoration: "none"
  },
  section: {
    padding: 24,
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#f8fafc",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.08)"
  },
  sectionTitle: {
    margin: "0 0 18px",
    color: "#172033",
    fontSize: 17,
    fontWeight: 900,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  emptyState: {
    margin: 0,
    color: "#64748b",
    fontSize: 15,
    fontWeight: 600
  },
  tableWrapper: {
    overflowX: "auto",
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#ffffff"
  },
  table: {
    width: "100%",
    minWidth: 2180,
    borderCollapse: "collapse"
  },
  tableHeader: {
    padding: "13px 12px",
    borderBottom: "2px solid #94a3b8",
    background: "#e2e8f0",
    color: "#172033",
    fontSize: 13,
    fontWeight: 900,
    textAlign: "left",
    whiteSpace: "nowrap"
  },
  tableRow: {
    borderBottom: "1px solid #cbd5e1"
  },
  tableCell: {
    padding: "15px 12px",
    color: "#1e293b",
    fontSize: 14,
    fontWeight: 600,
    verticalAlign: "middle",
    whiteSpace: "nowrap"
  },
  tableCellStrong: {
    padding: "15px 12px",
    color: "#111827",
    fontSize: 14,
    fontWeight: 900,
    verticalAlign: "middle"
  },
  tableCellFeature: {
    minWidth: 230,
    padding: "15px 12px",
    verticalAlign: "middle"
  },
  tableCellReadiness: {
    minWidth: 270,
    padding: "12px",
    verticalAlign: "middle"
  },
  readinessList: {
    display: "grid",
    gap: 8
  },
  readinessRow: {
    display: "grid",
    gridTemplateColumns: "52px 88px 48px",
    alignItems: "center",
    gap: 7
  },
  readinessNext: {
    gridColumn: "1 / 4",
    color: "#64748b",
    fontSize: 10,
    lineHeight: 1.35
  },
  readinessLabel: {
    color: "#334155",
    fontSize: 11,
    fontWeight: 850
  },
  readinessProgress: {
    width: 88,
    height: 7,
    accentColor: "#16794a"
  },
  ready: {
    color: "#067647",
    fontSize: 11
  },
  inProgress: {
    color: "#9a6400",
    fontSize: 11
  },
  notIncluded: {
    gridColumn: "2 / 4",
    color: "#64748b",
    fontSize: 11,
    fontWeight: 700
  },
  muted: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: 700
  },
  slug: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 600
  }
};

