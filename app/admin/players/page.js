import { prisma } from "@/lib/prisma";
import { effectivePlayerStatus } from "@/lib/player-tokens.mjs";
import NewPlayerForm from "./NewPlayerForm";
import PlayerHealthOperations from "./PlayerHealthOperations";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const [organisations, players] = await Promise.all([
    prisma.organisation.findMany({
      orderBy: { name: "asc" },
      include: {
        locations: {
          orderBy: { name: "asc" },
          include: { zones: { orderBy: { name: "asc" } } }
        }
      }
    }),
    prisma.player.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        organisation: true,
        zone: { include: { location: true } }
      }
    })
  ]);

  return (
    <div style={styles.page}>
      <header>
        <p style={styles.eyebrow}>PLAYBACK OPERATIONS</p>
        <h1 style={styles.heading}>Players and health</h1>
        <p style={styles.subtitle}>Enrol persistent web players, bind them to zones, and operate sampled heartbeat history with an auditable incident workflow.</p>
      </header>

      <NewPlayerForm organisations={organisations} />
      <PlayerHealthOperations />

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Registered players</h2>
        {players.length === 0 ? <p style={styles.subtitle}>No players have been registered.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead><tr><th style={styles.th}>Player</th><th style={styles.th}>Organisation</th><th style={styles.th}>Location / zone</th><th style={styles.th}>Health</th><th style={styles.th}>Last heartbeat</th></tr></thead>
              <tbody>{players.map((player) => {
                const health = effectivePlayerStatus(player);
                return <tr key={player.id}>
                  <td style={styles.tdStrong}>{player.name}</td>
                  <td style={styles.td}>{player.organisation.name}</td>
                  <td style={styles.td}>{player.zone.location.name} / {player.zone.name}</td>
                  <td style={styles.td}><span style={{ ...styles.badge, ...(health === "ONLINE" ? styles.online : health === "OFFLINE" ? styles.offline : styles.pending) }}>{health.replaceAll("_", " ")}</span></td>
                  <td style={styles.td}>{player.lastHeartbeatAt ? player.lastHeartbeatAt.toLocaleString() : "Waiting for enrolment"}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: { maxWidth: 1180, margin: "0 auto", padding: "36px 24px 72px", display: "grid", gap: 24, color: "#0f172a" },
  eyebrow: { margin: "0 0 8px", color: "#b45309", fontWeight: 900, fontSize: 12, letterSpacing: 1.4 },
  heading: { margin: 0, fontSize: 38 },
  subtitle: { color: "#475569", lineHeight: 1.6, maxWidth: 760 },
  card: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 22, background: "#fff" },
  sectionTitle: { margin: "0 0 16px", fontSize: 22 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 760 },
  th: { padding: 10, textAlign: "left", borderBottom: "2px solid #cbd5e1", color: "#475569", fontSize: 13 },
  td: { padding: 10, borderBottom: "1px solid #e2e8f0", color: "#334155" },
  tdStrong: { padding: 10, borderBottom: "1px solid #e2e8f0", fontWeight: 800 },
  badge: { display: "inline-block", padding: "5px 8px", borderRadius: 999, fontSize: 12, fontWeight: 900 },
  online: { background: "#dcfce7", color: "#166534" },
  offline: { background: "#fee2e2", color: "#991b1b" },
  pending: { background: "#fef3c7", color: "#92400e" }
};

