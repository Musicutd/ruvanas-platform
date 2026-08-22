import Link from "next/link";
import { prisma } from "@/lib/prisma";
import CreateStationForm from "./CreateStationForm";

export default async function NewStationPage() {
  const organisations = await prisma.organisation.findMany({
    orderBy: {
      name: "asc"
    }
  });

  return (
    <main style={styles.page}>
      <Link href="/admin/stations" style={styles.backLink}>
        ← Back to stations
      </Link>

      <div style={styles.header}>
        <p style={styles.eyebrow}>Technical streaming</p>
        <h1 style={styles.title}>Add station</h1>
        <p style={styles.description}>
          Create a technical station for an organisation. Stream URL and
          Centova credentials are configured separately after the station is
          created.
        </p>
      </div>

      <section style={styles.section}>
        <CreateStationForm organisations={organisations} />
      </section>
    </main>
  );
}

const styles = {
  page: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "40px 16px 64px",
    color: "#172033"
  },
  backLink: {
    display: "inline-block",
    marginBottom: 28,
    color: "#9a6400",
    fontSize: 15,
    fontWeight: 800,
    textDecoration: "none"
  },
  header: {
    marginBottom: 24
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
    maxWidth: 650,
    margin: "10px 0 0",
    color: "#475569",
    fontSize: 15,
    lineHeight: 1.55
  },
  section: {
    padding: 24,
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#f8fafc",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.08)"
  }
};
