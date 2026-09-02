import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import MusicModeStatusButton from "./MusicModeStatusButton";
import PageHeader from "@/app/components/PageHeader";
import EmptyState from "@/app/components/EmptyState";
import { interfaceMessages } from "@/lib/interface-guidance.mjs";

export default async function MusicModesPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/channels");

  const modes = await prisma.musicMode.findMany({
    include: {
      organisation: { select: { name: true } },
      _count: { select: { tracks: true } }
    },
    orderBy: [{ organisation: { name: "asc" } }, { name: "asc" }]
  });

  return (
    <main style={styles.page}>
      <PageHeader
        eyebrow="Radio control"
        title={interfaceMessages.musicModes.title}
        description="Build reusable customer music profiles and activate them only when their approved tracks are ready for scheduling."
      >
        <Link href="/admin/music-modes/new" style={styles.action}>Create music mode</Link>
      </PageHeader>

      {modes.length === 0 ? (
        <EmptyState
          title={interfaceMessages.musicModes.emptyTitle}
          description={interfaceMessages.musicModes.emptyDescription}
          actionHref="/admin/music-modes/new"
          actionLabel="Create music mode"
        />
      ) : (
        <section style={styles.tableWrap}>
          <table style={styles.table}>
            <thead><tr><th scope="col" style={styles.th}>Mode</th><th scope="col" style={styles.th}>Organisation</th><th scope="col" style={styles.th}>Tracks</th><th scope="col" style={styles.th}>Status</th><th scope="col" style={styles.th}>Updated</th><th scope="col" style={styles.th}>Action</th></tr></thead>
            <tbody>{modes.map((mode) => (
              <tr key={mode.id} style={styles.row}>
                <td style={styles.strong}><div>{mode.name}</div><small style={styles.muted}>{mode.slug}</small></td>
                <td style={styles.td}>{mode.organisation.name}</td>
                <td style={styles.td}>{mode._count.tracks}</td>
                <td style={styles.td}>{mode.status}</td>
                <td style={styles.td}>{new Date(mode.updatedAt).toLocaleDateString()}</td>
                <td style={styles.td}><MusicModeStatusButton modeId={mode.id} status={mode.status} trackCount={mode._count.tracks} /></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </main>
  );
}

const styles = {
  page:{maxWidth:1100,margin:"0 auto",padding:"40px 16px 64px",color:"#172033"},
  header:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:20,flexWrap:"wrap",marginBottom:24},
  eyebrow:{margin:"0 0 8px",color:"#9a6400",fontSize:13,fontWeight:900,letterSpacing:1,textTransform:"uppercase"},
  title:{margin:0,fontSize:32,fontWeight:900},description:{maxWidth:700,margin:"10px 0 0",color:"#475569",lineHeight:1.55},
  action:{background:"#f4b942",color:"#172033",padding:"10px 14px",borderRadius:7,fontWeight:900,textDecoration:"none"},
  empty:{padding:24,border:"1px dashed #94a3b8",borderRadius:12,background:"#f8fafc"},emptyText:{margin:"8px 0 0",color:"#64748b"},
  tableWrap:{overflowX:"auto",border:"1px solid #cbd5e1",borderRadius:10},table:{width:"100%",minWidth:720,borderCollapse:"collapse"},
  th:{padding:13,textAlign:"left",background:"#e2e8f0",borderBottom:"2px solid #94a3b8"},row:{borderBottom:"1px solid #cbd5e1"},
  td:{padding:14,fontWeight:600},strong:{padding:14,fontWeight:900},muted:{color:"#64748b",fontWeight:600}
};
