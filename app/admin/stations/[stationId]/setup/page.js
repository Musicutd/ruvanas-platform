import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import AdminStationSetupForm from "./AdminStationSetupForm";

export default async function AdminStationSetupPage({ params }) {
  const station = await prisma.station.findUnique({
    where: {
      id: params.stationId
    },
    include: {
      organisation: true,
      streamConfig: true
    }
  });

  if (!station) {
    notFound();
  }

  const initialData = {
    streamUrl: station.streamConfig?.streamUrl ?? "",
    mountPoint: station.streamConfig?.mountPoint ?? "",
    serverHost: station.streamConfig?.serverHost ?? "",
    serverPort: station.streamConfig?.serverPort?.toString() ?? "",
    bitrateKbps: station.streamConfig?.bitrateKbps?.toString() ?? "",
    centovaUsername: station.streamConfig?.centovaUsername ?? "",
    providerKey: station.streamConfig?.providerKey ?? "CENTOVA_CAST",
    backupStreamUrl: station.streamConfig?.backupStreamUrl ?? "",
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
        Configure the current Centova or generic HTTP stream without changing the player-facing station model.
        Leave a password blank if you do not want to change it.
      </p>

      <AdminStationSetupForm
        stationId={station.id}
        stationName={station.name}
        initialData={initialData}
      />
    </div>
  );
}
