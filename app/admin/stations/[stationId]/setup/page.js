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
    adminPassword: "",
    sourcePassword: ""
  };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        Configure streaming for {station.name}
      </h1>

      <p style={{ color: "#9fb3c8", marginBottom: 24 }}>
        Enter the Centova and streaming-server details for this station.
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
