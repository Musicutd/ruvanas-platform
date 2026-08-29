"use client";

import { useEffect, useState } from "react";

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "No deadline";
}

function Status({ value }) {
  return <span style={styles.badge}>{String(value || "").replaceAll("_", " ")}</span>;
}

export default function SchoolStudentWorkspace() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/school-student/workspace", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "The student workspace is unavailable.");
        return payload;
      })
      .then(setData)
      .catch((loadError) => setError(loadError.message));
  }, []);

  if (!data) return <main style={styles.page}><section style={styles.hero}><p style={styles.eyebrow}>RUVANAS · PRIVATE STUDENT WORKSPACE</p><h1 style={styles.title}>{error || "Loading your workspace…"}</h1>{error ? <form action="/api/auth/logout" method="post"><button style={styles.secondary}>Sign out</button></form> : null}</section></main>;

  return <main style={styles.page}>
    <header style={styles.topbar}><a href="/school-student" style={styles.brand}>RUVANAS SCHOOL RADIO</a><form action="/api/auth/logout" method="post"><button style={styles.secondary}>Sign out</button></form></header>
    <section style={styles.content}>
      <section style={styles.hero}><p style={styles.eyebrow}>PRIVATE · SCHOOL-MANAGED</p><h1 style={styles.title}>Welcome, {data.student.displayName}</h1><p style={styles.subtitle}>{data.school.name} · {data.student.group.name}{data.student.group.academicYear ? ` · ${data.student.group.academicYear}` : ""}</p></section>

      <section style={styles.grid}>
        <article style={styles.card}><p style={styles.eyebrow}>ASSIGNMENTS</p><h2 style={styles.cardTitle}>Your open work</h2>{!data.assignments.length ? <p style={styles.empty}>No open assignments.</p> : data.assignments.map((item) => <div key={item.id} style={styles.item}><div style={styles.row}><strong>{item.title}</strong><span style={styles.date}>{formatDate(item.dueAt)}</span></div>{item.programme ? <p style={styles.meta}>{item.programme.title}</p> : null}{item.brief ? <p style={styles.body}>{item.brief}</p> : null}{item.rubric ? <details style={styles.details}><summary>View assessment criteria</summary><ul>{item.rubric.criteria.map((criterion) => <li key={criterion.position}>{criterion.label} · {criterion.maxScore} points</li>)}</ul></details> : null}</div>)}</article>

        <article style={styles.card}><p style={styles.eyebrow}>EPISODES</p><h2 style={styles.cardTitle}>Your supervised productions</h2>{!data.episodes.length ? <p style={styles.empty}>No linked episodes.</p> : data.episodes.map((item) => <div key={item.id} style={styles.item}><div style={styles.row}><strong>{item.title}</strong><Status value={item.status} /></div><p style={styles.meta}>{item.programme.title} · private school workflow</p>{item.summary ? <p style={styles.body}>{item.summary}</p> : null}</div>)}</article>
      </section>

      <section style={styles.grid}>
        <article style={styles.card}><p style={styles.eyebrow}>FEEDBACK</p><h2 style={styles.cardTitle}>Submissions and released assessments</h2>{!data.submissions.length ? <p style={styles.empty}>No submissions recorded.</p> : data.submissions.map((item) => <div key={item.id} style={styles.item}><div style={styles.row}><strong>{item.assignment.title}</strong><Status value={item.status} /></div><p style={styles.meta}>Revision {item.revision} · {formatDate(item.submittedAt)}</p>{item.assessment ? <div style={styles.feedback}><strong>{item.assessment.totalScore} / {item.assessment.maximumScore}</strong>{item.assessment.narrativeNotes ? <p style={styles.body}>{item.assessment.narrativeNotes}</p> : null}{item.assessment.revisionRequest ? <p style={styles.body}>Next revision: {item.assessment.revisionRequest}</p> : null}</div> : <p style={styles.empty}>Staff feedback has not been released.</p>}</div>)}</article>

        <article style={styles.card}><p style={styles.eyebrow}>PRIVATE PORTFOLIO</p><h2 style={styles.cardTitle}>Your saved learning record</h2>{!data.portfolio.length ? <p style={styles.empty}>No private portfolio entries.</p> : data.portfolio.map((item) => <div key={item.id} style={styles.item}><strong>{item.title}</strong>{item.projectRole ? <p style={styles.meta}>Role: {item.projectRole}</p> : null}{item.reflection ? <p style={styles.body}>{item.reflection}</p> : null}</div>)}</article>
      </section>

      <p style={styles.safety}>This workspace is read-only and private. It has no staff dashboard, administration tools, direct messaging, public publishing, or authority outside your school.</p>
    </section>
  </main>;
}

const styles = {
  page: { minHeight: "100vh", background: "#101827", color: "#fff", fontFamily: "Arial, sans-serif" },
  topbar: { minHeight: 68, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, padding: "0 max(20px, calc((100vw - 1160px)/2))", borderBottom: "1px solid #2b3a54", background: "#141e2f" },
  brand: { color: "#f4b942", textDecoration: "none", fontWeight: 900, letterSpacing: 1.5 },
  secondary: { border: "1px solid #61708a", borderRadius: 8, background: "transparent", color: "#fff", padding: "9px 13px", fontWeight: 800, cursor: "pointer" },
  content: { width: "min(1160px, calc(100% - 40px))", margin: "0 auto", padding: "52px 0 72px" },
  hero: { width: "min(1160px, calc(100% - 40px))", margin: "0 auto", padding: "52px 0 24px" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.3, margin: "0 0 9px" },
  title: { fontSize: "clamp(34px,5vw,54px)", margin: 0 },
  subtitle: { color: "#b8c3d6", fontSize: 17, margin: "14px 0 0" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20, marginTop: 20 },
  card: { border: "1px solid #2b3a54", borderRadius: 15, background: "#182235", padding: 22 },
  cardTitle: { margin: "0 0 18px" },
  item: { borderTop: "1px solid #34445f", padding: "15px 0" },
  row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  date: { color: "#aebace", fontSize: 12, whiteSpace: "nowrap" },
  meta: { color: "#9facbf", fontSize: 13, margin: "7px 0" },
  body: { color: "#d4dceb", lineHeight: 1.55, margin: "8px 0" },
  empty: { color: "#9facbf", lineHeight: 1.5 },
  badge: { borderRadius: 5, background: "#dbeafe", color: "#1e40af", padding: "4px 7px", fontSize: 10, fontWeight: 900, whiteSpace: "nowrap" },
  details: { color: "#cbd5e1", fontSize: 13, marginTop: 10 },
  feedback: { borderLeft: "3px solid #f4b942", paddingLeft: 12, marginTop: 10 },
  safety: { color: "#8ea0b8", fontSize: 12, lineHeight: 1.5, margin: "24px 0 0" }
};
