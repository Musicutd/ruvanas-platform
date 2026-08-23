import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const plannedGenres = [
  {
    name: "Dance",
    description: "Dance, club, house, electronic, and high-energy formats."
  },
  {
    name: "Pop",
    description: "Contemporary pop, mainstream hits, and accessible melodic music."
  },
  {
    name: "R&B",
    description: "Rhythm and blues, soul, contemporary R&B, and smooth formats."
  },
  {
    name: "Country",
    description: "Country, contemporary country, and country-pop formats."
  },
  {
    name: "Hip Hop",
    description: "Hip hop, rap, urban, and related contemporary formats."
  }
];

export default async function AdminCataloguePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "SUPER_ADMIN") {
    redirect("/admin/media");
  }

  const genres = await prisma.mediaGenre.findMany({
    orderBy: {
      name: "asc"
    }
  });

  const catalogueAssets = await prisma.mediaAsset.findMany({
    where: {
      libraryType: "RUVANAS_CATALOGUE",
      status: {
        notIn: ["ARCHIVED", "DELETED"]
      }
    },
    include: {
      genres: {
        include: {
          mediaGenre: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const visibleGenres =
    genres.length > 0
      ? genres.map((genre) => ({
          name: genre.name,
          description: "Configured Ruvanas catalogue genre."
        }))
      : plannedGenres;

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <div>
          <p style={styles.eyebrow}>Ruvanas-managed audio</p>
          <h1 style={styles.title}>Music Catalogue</h1>
          <p style={styles.description}>
            This is the future platform-wide music catalogue. Only Ruvanas
            Super Admins can manage catalogue tracks. Organisation-owned promos
            remain private and are managed in the Promo Library.
          </p>
        </div>

        <Link href="/admin/media" style={styles.backLink}>
          Open Promo Library
        </Link>
      </div>

      <section style={styles.notice}>
        <h2 style={styles.noticeTitle}>Commercial music is not enabled</h2>
        <p style={styles.noticeText}>
          Catalogue uploads and organisation access remain disabled until
          Ruvanas has the appropriate commercial-music licensing, rights,
          territory, and distribution arrangements in place. Do not upload
          ordinary commercial tracks here at this stage.
        </p>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Planned music genres</h2>
            <p style={styles.sectionDescription}>
              These categories are ready for future catalogue tracks and
              organisation-level music preferences.
            </p>
          </div>

          <span style={styles.countBadge}>
            {visibleGenres.length} genres
          </span>
        </div>

        <div style={styles.genreGrid}>
          {visibleGenres.map((genre) => (
            <article key={genre.name} style={styles.genreCard}>
              <h3 style={styles.genreName}>{genre.name}</h3>
              <p style={styles.genreDescription}>{genre.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Catalogue tracks</h2>
            <p style={styles.sectionDescription}>
              Catalogue tracks will appear here after rights-cleared content is
              approved and published by Ruvanas.
            </p>
          </div>

          <span style={styles.countBadge}>
            {catalogueAssets.length} tracks
          </span>
        </div>

        {catalogueAssets.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>No catalogue tracks are available.</p>
            <p style={styles.emptyText}>
              The catalogue is intentionally empty while commercial music
              licensing is deferred. Organisation users cannot access this
              catalogue at this time.
            </p>
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.tableHeader}>Track</th>
                  <th style={styles.tableHeader}>Genres</th>
                  <th style={styles.tableHeader}>Type</th>
                  <th style={styles.tableHeader}>Status</th>
                  <th style={styles.tableHeader}>Added</th>
                </tr>
              </thead>

              <tbody>
                {catalogueAssets.map((asset) => (
                  <tr key={asset.id} style={styles.tableRow}>
                    <td style={styles.tableCellStrong}>
                      <div>{asset.name}</div>
                      <div style={styles.originalName}>
                        {asset.originalName}
                      </div>
                    </td>

                    <td style={styles.tableCell}>
                      {asset.genres.length > 0
                        ? asset.genres
                            .map((item) => item.mediaGenre.name)
                            .join(", ")
                        : "Uncategorised"}
                    </td>

                    <td style={styles.tableCell}>{asset.mediaType}</td>

                    <td style={styles.tableCell}>
                      <span style={styles.statusBadge}>{asset.status}</span>
                    </td>

                    <td style={styles.tableCell}>
                      {new Date(asset.createdAt).toLocaleDateString()}
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
    maxWidth: 710,
    margin: "10px 0 0",
    color: "#475569",
    fontSize: 15,
    lineHeight: 1.55
  },
  backLink: {
    color: "#7c4a03",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "underline"
  },
  notice: {
    marginBottom: 24,
    padding: 20,
    border: "1px solid #fbbf24",
    borderRadius: 12,
    background: "#fffbeb"
  },
  noticeTitle: {
    margin: 0,
    color: "#92400e",
    fontSize: 17,
    fontWeight: 900
  },
  noticeText: {
    margin: "8px 0 0",
    color: "#78350f",
    fontSize: 14,
    lineHeight: 1.55
  },
  section: {
    marginTop: 24,
    padding: 24,
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#f8fafc",
    boxShadow: "0 2px 6px rgba(15, 23, 42, 0.08)"
  },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 18
  },
  sectionTitle: {
    margin: 0,
    color: "#172033",
    fontSize: 17,
    fontWeight: 900,
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  sectionDescription: {
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.5
  },
  countBadge: {
    display: "inline-block",
    borderRadius: 999,
    background: "#e2e8f0",
    color: "#334155",
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: "nowrap"
  },
  genreGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 14
  },
  genreCard: {
    padding: 16,
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#ffffff"
  },
  genreName: {
    margin: 0,
    color: "#172033",
    fontSize: 16,
    fontWeight: 900
  },
  genreDescription: {
    margin: "7px 0 0",
    color: "#64748b",
    fontSize: 13,
    lineHeight: 1.45
  },
  emptyState: {
    padding: 22,
    border: "1px dashed #94a3b8",
    borderRadius: 9,
    background: "#ffffff"
  },
  emptyTitle: {
    margin: 0,
    color: "#172033",
    fontSize: 16,
    fontWeight: 900
  },
  emptyText: {
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 14,
    lineHeight: 1.5
  },
  tableWrapper: {
    overflowX: "auto",
    border: "1px solid #cbd5e1",
    borderRadius: 9,
    background: "#ffffff"
  },
  table: {
    width: "100%",
    minWidth: 720,
    borderCollapse: "collapse"
  },
  tableHeader: {
    padding: "13px 12px",
    borderBottom: "2px solid #94a3b8",
    background: "#e2e8f0",
    color: "#172033",
    fontSize: 13,
    fontWeight: 900,
    textAlign: "left",
    whiteSpace: "nowrap"
  },
  tableRow: {
    borderBottom: "1px solid #cbd5e1"
  },
  tableCell: {
    padding: "15px 12px",
    color: "#1e293b",
    fontSize: 14,
    fontWeight: 600,
    verticalAlign: "middle"
  },
  tableCellStrong: {
    padding: "15px 12px",
    color: "#111827",
    fontSize: 14,
    fontWeight: 900,
    verticalAlign: "middle",
    minWidth: 250
  },
  originalName: {
    marginTop: 4,
    color: "#64748b",
    fontSize: 12,
    fontWeight: 600
  },
  statusBadge: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 5,
    background: "#e2e8f0",
    color: "#334155",
    fontSize: 12,
    fontWeight: 900
  }
};
