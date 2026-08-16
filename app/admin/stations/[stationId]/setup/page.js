import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AdminStationSetupForm from "./AdminStationSetupForm";

export default async function AdminStationSetupPage({ params }) {
  const admin = await getAdminUser();
  if (!admin) {
    redirect("/login");
  }

  const station = await prisma.station.findUnique({
    where: { id: params.stationId },
    include: {
      organisation: {
        include: {
          subscription: {
            include: {
              plan: true
            }
          }
        }
      }
    }
  });

  if (!station) {
    redirect("/admin/stations");
  }

  const config = await prisma.stationStreamConfig.findUnique({
    where: { stationId: station.id }
  });

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <a href="/admin/stations" style={styles.brand}>RUVANAS ADMIN</a>
        <span style={styles.subheader}>Configure streaming</span>
      </header>

      <section style={styles.content}>
        <p style={styles.eyebrow}>STATION SETUP</p>
        <h1 style={styles.title}>{station.name}</h1>
        <p style={styles.subtitle}>
          Configure Centova streaming details for this station. Changes are saved immediately.
        </p>

        <AdminStationSetupForm
          stationId={station.id}
          stationName={station.name}
          initialData={config ? {
            streamUrl: config.streamUrl || "",
            mountPoint: config.mountPoint || "",
            serverHost: config.serverHost || "",
            serverPort: config.serverPort?.toString() || "",
            bitrateKbps: config.bitrateKbps?.toString() || "",
            centovaUsername: config.centovaUsername || "",
            adminPassword: "",
            sourcePassword: ""
          } : null}
        />
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#0f172a",
    color: "#ffffff",
    fontFamily: "Arial, sans-serif"
  },
  header: {
    minHeight: 72,
    display: "flex",
    alignItems: "center",
    gap: 24,
    padding: "0 32px",
    borderBottom: "1px solid #26344d",
    background: "#141e2f"
  },
  brand: {
    color: "#f4b942",
    fontWeight: 800,
    letterSpacing: 2,
    textDecoration: "none"
  },
  subheader: {
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: 600
  },
  content: {
    width: "min(900px, calc(100% - 40px))",
    margin: "0 auto",
    padding: "56px 0 72px"
  },
  eyebrow: {
    color: "#f4b942",
    letterSpacing: 1.5,
    fontSize: 12,
    fontWeight: 700,
    margin: "0 0 12px",
    textTransform: "uppercase"
  },
  title: {
    fontSize: "clamp(28px, 4vw, 42px)",
    margin: 0
  },
  subtitle: {
    color: "#b8c3d6",
    lineHeight: 1.6,
    fontSize: 16,
    maxWidth: 720,
    margin: "16px 0 36px"
  }
};
