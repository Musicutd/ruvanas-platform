import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verify } from "jsonwebtoken";
import prisma from "@/lib/prisma";
import AdminStationSetupForm from "./AdminStationSetupForm";

export default async function AdminStationSetupPage({ params }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin_token")?.value;

  if (!token) {
    redirect("/admin/login");
  }

  let adminId;
  try {
    const decoded = verify(token, process.env.JWT_SECRET);
    adminId = decoded.adminId;
  } catch {
    redirect("/admin/login");
  }

  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { id: true, name: true, email: true }
  });

  if (!admin) {
    redirect("/admin/login");
  }

  const stationId = params.stationId;

  const station = await prisma.station.findUnique({
    where: { id: stationId },
    select: {
      id: true,
      name: true,
      streamingSetup: {
        select: {
          streamUrl: true,
          mountPoint: true,
          serverHost: true,
          serverPort: true,
          bitrateKbps: true,
          centovaUsername: true
          // do NOT select passwords
        }
      }
    }
  });

  if (!station) {
    redirect("/admin/stations");
  }

  const initialData = station.streamingSetup
    ? {
        streamUrl: station.streamingSetup.streamUrl ?? "",
        mountPoint: station.streamingSetup.mountPoint ?? "",
        serverHost: station.streamingSetup.serverHost ?? "",
        serverPort: station.streamingSetup.serverPort ?? "",
        bitrateKbps: station.streamingSetup.bitrateKbps ?? "",
        centovaUsername: station.streamingSetup.centovaUsername ?? "",
        adminPassword: "",
        sourcePassword: ""
      }
    : {
        streamUrl: "",
        mountPoint: "",
        serverHost: "",
        serverPort: "",
        bitrateKbps: "",
        centovaUsername: "",
        adminPassword: "",
        sourcePassword: ""
      };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        Configure streaming for {station.name}
      </h1>

      <p style={{ color: "#9fb3c8", marginBottom: 24 }}>
        Enter your Centova / streaming server details. Passwords are optional if you do not want to change them.
      </p>

      <AdminStationSetupForm
        stationId={stationId}
        stationName={station.name}
        initialData={initialData}
      />
    </div>
  );
}
