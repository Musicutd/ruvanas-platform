import { notFound, redirect } from "next/navigation";
import { getActiveOrganisationContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ContextHelp from "@/app/components/ContextHelp";
import SkipLink from "@/app/components/SkipLink";

export default async function StationDetailsPage({ params }) {
  const context = await getActiveOrganisationContext();

  if (!context) {
    redirect("/login");
  }

  const membership = context.membership;

  if (!membership) {
    redirect("/register");
  }

  const station = await prisma.station.findFirst({
    where: {
      id: params.stationId,
      organisationId: membership.organisationId
    },
    include: {
      streamConfig: true
    }
  });

  if (!station) {
    notFound();
  }

  const needsSetup = station.status === "PENDING_SETUP";

  return (
    <main style={styles.page}>
      <SkipLink />
      <header style={styles.header}>
        <a href="/dashboard" style={styles.brand}>RUVANAS</a>
        <a href="/dashboard" style={styles.backLink}>Dashboard</a>
      </header>

      <section style={styles.content} id="main-content">
        <p style={styles.eyebrow}>STATION MANAGEMENT</p>
        <h1 style={styles.title}>{station.name}</h1>
        <p style={styles.subtitle}>
          {station.description || "Your online radio station workspace."}
        </p>

        <section style={styles.statusCard}>
          <div>
            <p style={styles.cardLabel}>Station status</p>
            <h2 style={styles.status}>{station.status.replace("_", " ")}</h2>
          </div>

          {needsSetup ? (
            <a href={`/stations/${station.id}/setup`} style={styles.setupButton}>
              Configure streaming
            </a>
          ) : (
            <span style={styles.badge}>Streaming configured</span>
          )}
        </section>

        <section style={styles.grid}>
          <article style={styles.card}>
            <p style={styles.cardLabel}>Listener capacity</p>
            <h2 style={styles.cardValue}>{station.listenerLimit}</h2>
            <p style={styles.cardText}>Simultaneous listeners</p>
          </article>

          <article style={styles.card}>
            <p style={styles.cardLabel}>AutoDJ storage</p>
            <h2 style={styles.cardValue}>{station.storageLimitGb} GB</h2>
            <p style={styles.cardText}>Allocated storage</p>
          </article>

          <article style={styles.card}>
            <p style={styles.cardLabel}>Maximum bitrate</p>
            <h2 style={styles.cardValue}>{station.maxBitrateKbps} kbps</h2>
            <p style={styles.cardText}>Stream quality limit</p>
          </article>
        </section>

        <ContextHelp
          title="Help with this station"
          introduction="The station supplies audio, while Ruvanas-managed programming and enrolled shop players control what each listening location receives."
          items={[
            { title: "Station status", description: "Pending setup needs streaming details. Active means the station connection is configured." },
            { title: "Programming", description: "Approved music modes and schedules are prepared separately for each shop or zone." },
            { title: "Playback", description: "Use Shop players to enrol devices and verify recent live playback evidence." }
          ]}
          articleHref="/dashboard/help#station-setup"
          articleLabel="Open the station guide"
        />

        <section style={styles.nextCard}>
          <p style={styles.eyebrow}>NEXT ACTIONS</p>
          <h2 style={styles.nextTitle}>Content and shop playback</h2>
          <p style={styles.cardText}>
            Upload your organisation's announcements and promotions, or prepare the secure player used in each subscribed shop.
          </p>
          <div style={styles.actions}>
            <a href="/dashboard/media" style={styles.secondaryButton}>Open media library</a>
            <a href="/dashboard/players" style={styles.setupButton}>Open shop players</a>
          </div>
        </section>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#101827",
    color: "#ffffff",
    fontFamily: "Arial, sans-serif"
  },
  header: {
    minHeight: 72,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
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
  backLink: {
    color: "#d8e0ec",
    textDecoration: "none"
  },
  content: {
    width: "min(1080px, calc(100% - 40px))",
    margin: "0 auto",
    padding: "56px 0 72px"
  },
  eyebrow: {
    color: "#f4b942",
    letterSpacing: 1.5,
    fontSize: 12,
    fontWeight: 700,
    margin: "0 0 12px"
  },
  title: {
    fontSize: "clamp(36px, 6vw, 60px)",
    margin: 0
  },
  subtitle: {
    color: "#b8c3d6",
    fontSize: 18,
    lineHeight: 1.6,
    margin: "16px 0 32px"
  },
  statusCard: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 20,
    flexWrap: "wrap",
    background: "#182235",
    border: "1px solid #2b3a54",
    borderRadius: 14,
    padding: 24,
    marginBottom: 18
  },
  cardLabel: {
    color: "#9cacbf",
    fontSize: 13,
    fontWeight: 700,
    margin: "0 0 10px",
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  status: {
    fontSize: 24,
    margin: 0,
    textTransform: "capitalize"
  },
  badge: {
    background: "#3b3018",
    color: "#f4b942",
    border: "1px solid #806328",
    borderRadius: 999,
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: 700
  },
  setupButton: {
    background: "#f4b942",
    color: "#101827",
    border: "none",
    borderRadius: 8,
    padding: "12px 18px",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "none"
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 16
  },
  card: {
    background: "#182235",
    border: "1px solid #2b3a54",
    borderRadius: 14,
    padding: 22
  },
  cardValue: {
    fontSize: 30,
    margin: 0
  },
  cardText: {
    color: "#b8c3d6",
    lineHeight: 1.5,
    margin: "10px 0 0"
  },
  nextCard: {
    marginTop: 28,
    background: "linear-gradient(135deg, #2c2416, #1b2738)",
    border: "1px solid #645028",
    borderRadius: 16,
    padding: 28
  },
  nextTitle: {
    fontSize: 28,
    margin: "0 0 12px"
  },
  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 18
  },
  secondaryButton: {
    border: "1px solid #806328",
    borderRadius: 8,
    color: "#f4b942",
    padding: "12px 18px",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "none"
  }
};

