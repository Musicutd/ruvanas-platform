import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await prisma.organisationMember.findFirst({
    where: {
      userId: user.id
    },
    include: {
      organisation: {
        include: {
          subscription: {
            include: {
              plan: true
            }
          },
          stations: true
        }
      }
    }
  });

  if (!membership) {
    redirect("/register");
  }

  const organisation = membership.organisation;
  const subscription = organisation.subscription;
  const plan = subscription?.plan;

  const storageUsedMb = organisation.stations.reduce(
    (total, station) => total + station.storageUsedMb,
    0
  );

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <a href="/" style={styles.brand}>RUVANAS</a>

        <form action="/api/auth/logout" method="post">
          <button style={styles.logoutButton} type="submit">
            Sign out
          </button>
        </form>
      </header>

      <section style={styles.content}>
        <p style={styles.eyebrow}>CLIENT DASHBOARD</p>
        <h1 style={styles.title}>Welcome, {user.name || "Ruvanas client"}</h1>
        <p style={styles.subtitle}>
          Manage your radio services, plans, and future streaming configuration from one place.
        </p>

        <section style={styles.summaryGrid}>
          <article style={styles.card}>
            <p style={styles.cardLabel}>Organisation</p>
            <h2 style={styles.cardValue}>{organisation.name}</h2>
            <p style={styles.cardText}>Your Ruvanas workspace</p>
          </article>

          <article style={styles.card}>
            <p style={styles.cardLabel}>Current plan</p>
            <h2 style={styles.cardValue}>{plan?.name || "Trial"}</h2>
            <p style={styles.cardText}>
              {subscription?.status === "TRIAL" ? "30-day trial active" : subscription?.status || "No plan"}
            </p>
          </article>

          <article style={styles.card}>
            <p style={styles.cardLabel}>Stations</p>
            <h2 style={styles.cardValue}>
              {organisation.stations.length} / {plan?.stationLimit || 0}
            </h2>
            <p style={styles.cardText}>Online stations available</p>
          </article>

          <article style={styles.card}>
            <p style={styles.cardLabel}>Listener capacity</p>
            <h2 style={styles.cardValue}>{plan?.listenerLimit || 0}</h2>
            <p style={styles.cardText}>Simultaneous listener slots</p>
          </article>

          <article style={styles.card}>
            <p style={styles.cardLabel}>AutoDJ storage</p>
            <h2 style={styles.cardValue}>
              {(storageUsedMb / 1024).toFixed(2)} / {plan?.storageLimitGb || 0} GB
            </h2>
            <p style={styles.cardText}>Audio-library allocation</p>
          </article>

          <article style={styles.card}>
            <p style={styles.cardLabel}>Maximum quality</p>
            <h2 style={styles.cardValue}>{plan?.maxBitrateKbps || 0} kbps</h2>
            <p style={styles.cardText}>Maximum stream bitrate</p>
          </article>
        </section>

        <section style={styles.nextCard}>
          <div>
            <p style={styles.eyebrow}>NEXT STEP</p>
            <h2 style={styles.nextTitle}>Create your first radio station</h2>
            <p style={styles.nextText}>
              Your platform is ready. The next module will allow you to create
              stations and manage their Streamerr-backed infrastructure privately.
            </p>
          </div>

          <a href="/stations/new" style={styles.primaryButton}>
            Create station
          </a>
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
  logoutButton: {
    border: "1px solid #485a76",
    borderRadius: 8,
    background: "transparent",
    color: "#ffffff",
    padding: "9px 14px",
    cursor: "pointer"
  },
  content: {
    width: "min(1160px, calc(100% - 40px))",
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
    fontSize: "clamp(34px, 5vw, 54px)",
    margin: 0
  },
  subtitle: {
    color: "#b8c3d6",
    lineHeight: 1.6,
    fontSize: 18,
    maxWidth: 720,
    margin: "16px 0 36px"
  },
  summaryGrid: {
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
  cardLabel: {
    color: "#9cacbf",
    fontSize: 13,
    fontWeight: 700,
    margin: "0 0 12px",
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  cardValue: {
    fontSize: 26,
    margin: 0,
    overflowWrap: "anywhere"
  },
  cardText: {
    color: "#b8c3d6",
    margin: "10px 0 0",
    lineHeight: 1.45
  },
  nextCard: {
    background: "linear-gradient(135deg, #2c2416, #1b2738)",
    border: "1px solid #645028",
    borderRadius: 16,
    padding: 28,
    marginTop: 28,
    display: "flex",
    justifyContent: "space-between",
    gap: 24,
    alignItems: "center",
    flexWrap: "wrap"
  },
  nextTitle: {
    fontSize: 26,
    margin: "0 0 12px"
  },
  nextText: {
    color: "#d2d9e5",
    lineHeight: 1.6,
    maxWidth: 650,
    margin: 0
  },
  primaryButton: {
    display: "inline-block",
    background: "#f4b942",
    color: "#101827",
    padding: "13px 18px",
    borderRadius: 8,
    textDecoration: "none",
    fontWeight: 800,
    whiteSpace: "nowrap"
  }
};
