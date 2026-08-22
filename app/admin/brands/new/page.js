import Link from "next/link";
import { prisma } from "@/lib/prisma";
import CreateBrandForm from "./CreateBrandForm";

export default async function NewBrandPage() {
  const organisations = await prisma.organisation.findMany({
    orderBy: {
      name: "asc"
    }
  });

  return (
    <main style={styles.page}>
      <Link href="/admin/brands" style={styles.backLink}>
        ← Back to brands
      </Link>

      <div style={styles.header}>
        <p style={styles.eyebrow}>Brand management</p>
        <h1 style={styles.title}>Add brand</h1>
        <p style={styles.description}>
          Create a brand inside an organisation. You can then associate retail
          locations and Ruvanas Channels with it.
        </p>
      </div>

      <section style={styles.section}>
        {organisations.length === 0 ? (
          <p style={styles.emptyState}>
            An organisation must exist before you can create a brand.
          </p>
        ) : (
          <CreateBrandForm organisations={organisations} />
        )}
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
  },
  emptyState: {
    margin: 0,
    color: "#64748b",
    fontSize: 15,
    fontWeight: 600
  }
};
