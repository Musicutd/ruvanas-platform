import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/requireAdmin";
import AdminStationSetupForm from "./AdminStationSetupForm";
import AdminStreamingProfiles from "./AdminStreamingProfiles";

export default async function AdminStationSetupPage({ params }) {
  const user = await getAdminUser();
  if (user?.role !== "SUPER_ADMIN") redirect("/admin/stations");
  const { stationId } = await params;
  const station = await prisma.station.findUnique({
    where: {
      id: stationId
    },
    include: {
      organisation: true,
      streamConfig: true
    }
  });

  if (!station) {
    notFound();
  }

  const [channels, destinations, liveSources] = await Promise.all([
    prisma.channel.findMany({ where: { stationId: station.id, organisationId: station.organisationId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.studioBroadcastDestination.findMany({ where: { stationId: station.id, organisationId: station.organisationId }, select: { id: true, name: true, type: true, enabled: true }, orderBy: { name: "asc" } }),
    prisma.externalLiveSource.findMany({ where: { organisationId: station.organisationId, channel: { stationId: station.id }, status: { not: "ARCHIVED" } }, select: { id: true, name: true, status: true, channel: { select: { name: true } } }, orderBy: { createdAt: "desc" } })
  ]);

  const initialData = {
    streamUrl: station.streamConfig?.streamUrl ?? "",
    mountPoint: station.streamConfig?.mountPoint ?? "",
    serverHost: station.streamConfig?.serverHost ?? "",
    serverPort: station.streamConfig?.serverPort?.toString() ?? "",
    sourcePort: station.streamConfig?.sourcePort?.toString() ?? "",
    sourceUsername: station.streamConfig?.sourceUsername ?? "",
    outboundAutoDjEnabled: station.streamConfig?.outboundAutoDjEnabled ?? false,
    bitrateKbps: station.streamConfig?.bitrateKbps?.toString() ?? "",
    centovaUsername: station.streamConfig?.centovaUsername ?? "",
    providerKey: station.streamConfig?.providerKey ?? "CENTOVA_CAST",
    backupStreamUrl: station.streamConfig?.backupStreamUrl ?? "",
    sourceConnectionStatus: station.streamConfig?.sourceConnectionStatus ?? "DISCONNECTED",
    encoderLeaseUntil: station.streamConfig?.encoderLeaseUntil?.toISOString() ?? null,
    lastProbeHttpStatus: station.streamConfig?.lastProbeHttpStatus ?? null,
    lastError: station.streamConfig?.lastError ?? null,
    probeEnabled: station.streamConfig?.probeEnabled ?? true,
    probeIntervalSeconds: station.streamConfig?.probeIntervalSeconds?.toString() ?? "60",
    probeTimeoutMs: station.streamConfig?.probeTimeoutMs?.toString() ?? "8000",
    adminPassword: "",
    sourcePassword: ""
  };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        Configure streaming for {station.name}
      </h1>

      <p style={{ color: "#9fb3c8", marginBottom: 24 }}>
        Super Admin controls the private Centova or generic HTTP stream. Save the connection, then activate the station only after a live-source check succeeds. Leave a password blank to keep it unchanged.
      </p>

      <AdminStationSetupForm
        stationId={station.id}
        stationName={station.name}
        stationStatus={station.status}
        productFamily={station.productFamily}
        hasStreamConfig={Boolean(station.streamConfig?.streamUrl)}
        initialData={initialData}
      />
      <AdminStreamingProfiles stationId={station.id} channels={channels} destinations={destinations} liveSources={liveSources} />
    </div>
  );
}
