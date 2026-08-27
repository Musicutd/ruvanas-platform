import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export default async function MusicSchedulesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPER_ADMIN") redirect("/admin/channels");
  const schedules = await prisma.musicSchedule.findMany({
    include: {
      organisation: { select: { name: true } }, location: { select: { name: true } },
      zone: { select: { name: true, location: { select: { name: true } } } }, _count: { select: { slots: true } }
    },
    orderBy: [{ createdAt: "desc" }]
  });
  return <main style={styles.page}>
    <div style={styles.header}><div><p style={styles.eyebrow}>Radio Control</p><h1 style={styles.title}>Music schedules</h1><p style={styles.description}>Versioned weekly programming in each location’s local timezone. Zone schedules override location-wide schedules only while a matching slot is active.</p></div><Link href="/admin/music-schedules/new" style={styles.action}>Create schedule</Link></div>
    {schedules.length === 0 ? <section style={styles.empty}><strong>No schedules yet.</strong><p>Create a draft or publish the first weekly schedule.</p></section> : <section style={styles.tableWrap}><table style={styles.table}><thead><tr><th style={styles.th}>Schedule</th><th style={styles.th}>Target</th><th style={styles.th}>Organisation</th><th style={styles.th}>Version</th><th style={styles.th}>Slots</th><th style={styles.th}>Status</th><th style={styles.th}>Timezone</th></tr></thead><tbody>{schedules.map((item)=><tr key={item.id} style={styles.row}><td style={styles.strong}>{item.name}</td><td style={styles.td}>{item.zone ? `${item.zone.location.name} / ${item.zone.name}` : item.location?.name}</td><td style={styles.td}>{item.organisation.name}</td><td style={styles.td}>v{item.version}</td><td style={styles.td}>{item._count.slots}</td><td style={styles.td}>{item.status}</td><td style={styles.td}>{item.timezone}</td></tr>)}</tbody></table></section>}
  </main>;
}

const styles={page:{maxWidth:1180,margin:"0 auto",padding:"40px 16px 64px",color:"#172033"},header:{display:"flex",justifyContent:"space-between",gap:20,flexWrap:"wrap",marginBottom:24},eyebrow:{margin:"0 0 8px",color:"#9a6400",fontWeight:900,textTransform:"uppercase"},title:{margin:0,fontSize:32},description:{maxWidth:760,color:"#475569",lineHeight:1.55},action:{height:"fit-content",background:"#f4b942",color:"#172033",padding:"10px 14px",borderRadius:7,fontWeight:900,textDecoration:"none"},empty:{padding:24,border:"1px dashed #94a3b8",borderRadius:12,background:"#f8fafc"},tableWrap:{overflowX:"auto",border:"1px solid #cbd5e1",borderRadius:10},table:{width:"100%",minWidth:900,borderCollapse:"collapse"},th:{padding:13,textAlign:"left",background:"#e2e8f0",borderBottom:"2px solid #94a3b8"},row:{borderBottom:"1px solid #cbd5e1"},td:{padding:14,fontWeight:600},strong:{padding:14,fontWeight:900}};
