import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminBrandsPage() {
  const brands = await prisma.brand.findMany({
    include: {
      organisation: true,
      _count: {
        select: {
          locations: true,
          channels: true
        }
      }
    },
    orderBy: [
      {
        organisation: {
          name: "asc"
        }
      },
      {
        name: "asc"
      }
    ]
  });

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Brand management</p>
          <h1 style={styles.title}>Brands</h1>
          <p style={styles.description}>
            Brands organise retail locations and Ruvanas Channels within an
            organisation.
          </p>
        </div>

        <Link href="/admin/brands/new" style={styles.addButton}>
          Add brand
        </Link>
      </div>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Existing brands</h2>

        {brands.length === 0 ? (
          <p style={styles.emptyState}>
            No brands have been created yet.
          </p>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Brand</th>
                  <th style={styles.tableHeader}>Organisation</th>
                  <th style={styles.tableHeader}>Locations</th>
                  <th style={styles.tableHeader}>Channels</th>
                  <th style={styles.tableHeader}>Created</th>
                </tr>
              </thead>

              <tbody>
                {brands.map((brand) => (
                  <tr key={brand.id} style={styles.tableRow}>
                    <td style={styles.tableCellStrong}>{brand.name}</td>

                    <td style={styles.tableCell}>
                      {brand.organisation.name}
                    </td>

                    <td style={styles.tableCell}>
                      {brand._count.locations}
                    </td>

                    <td style={styles.tableCell}>
                      {brand._count.channels}
                    </td>

                    <td style={styles.tableCell}>
                      {new Date(brand.createdAt).toLocaleDateString()}
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
    maxWidth: 1100,
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
    maxWidth: 650,
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
    minWidth: 700,
    borderCollapse: "collapse"
  },
  tableHeader: {
    padding: "13px 12px",
    borderBottom: "2px solid #94a3b8",
    background: "#e2e8f0",
    color: "#172033",
    fontSize: 13,
    fontWeight: 900,
    textAlign: "left"
  },
  tableRow: {
    borderBottom: "1px solid #cbd5e1"
  },
  tableCell: {
    padding: "15px 12px",
    color: "#1e293b",
    fontSize: 15,
    fontWeight: 600
  },
  tableCellStrong: {
    padding: "15px 12px",
    color: "#111827",
    fontSize: 15,
    fontWeight: 900
  }
};
