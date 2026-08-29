import { notFound } from "next/navigation";
import { loadPublicSchoolPage } from "@/lib/public-school-podcast";

export const dynamic = "force-dynamic";

export default async function PublicSchoolRadioPage({ params }) {
  const { slug } = await params;
  const page = await loadPublicSchoolPage(String(slug || "").toLowerCase());
  if (!page) notFound();
  return <main style={styles.page}>
    <header style={styles.header}>
      <p style={styles.eyebrow}>RUVANAS SCHOOL RADIO</p>
      <h1 style={styles.title}>{page.school.name}</h1>
      <p style={styles.subtitle}>Staff-approved programmes published under the school&apos;s safeguarding and consent policy.</p>
    </header>
    {!page.episodes.length ? <section style={styles.empty}><h2>No public episodes yet</h2><p>Approved episodes will appear here when the school releases them.</p></section> : <section style={styles.list}>
      {page.episodes.map((episode) => <article key={episode.id} style={styles.card}>
        <div style={styles.meta}>{episode.series}{episode.programme ? ` · ${episode.programme}` : ""}</div>
        <h2 style={styles.cardTitle}>{episode.title}</h2>
        {episode.summary ? <p style={styles.body}>{episode.summary}</p> : null}
        {episode.accessibleDescription ? <p style={styles.accessibility}><strong>Accessible description:</strong> {episode.accessibleDescription}</p> : null}
        <audio controls preload="metadata" src={episode.audioPath} style={styles.audio}>Your browser does not support audio playback.</audio>
        <p style={styles.date}>Published {new Date(episode.publishedAt).toLocaleDateString()}</p>
      </article>)}
    </section>}
    <footer style={styles.footer}>Private contributor records, consent evidence, staff notes, and internal identifiers are never shown on this page.</footer>
  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#0f172a", color: "#f8fafc", padding: "56px max(20px,calc((100vw - 920px)/2)) 72px", fontFamily: "Arial, sans-serif" },
  header: { borderBottom: "1px solid #334155", paddingBottom: 28, marginBottom: 28 }, eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.5 }, title: { margin: "8px 0", fontSize: "clamp(38px,7vw,64px)" }, subtitle: { color: "#cbd5e1", lineHeight: 1.6, maxWidth: 700 },
  list: { display: "grid", gap: 18 }, card: { background: "#172033", border: "1px solid #334155", borderRadius: 14, padding: 22 }, meta: { color: "#f4b942", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.8 }, cardTitle: { margin: "8px 0 12px", fontSize: 27 }, body: { color: "#dbe4f0", lineHeight: 1.65 }, accessibility: { color: "#bac7d8", lineHeight: 1.55, borderLeft: "3px solid #60a5fa", paddingLeft: 10 }, audio: { width: "100%", marginTop: 12 }, date: { color: "#94a3b8", fontSize: 12 },
  empty: { background: "#172033", border: "1px solid #334155", borderRadius: 14, padding: 26, color: "#cbd5e1" }, footer: { marginTop: 28, color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }
};
