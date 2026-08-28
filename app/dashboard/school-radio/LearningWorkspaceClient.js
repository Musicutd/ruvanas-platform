"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function Badge({ value }) {
  return <span style={styles.badge}>{String(value).replaceAll("_", " ")}</span>;
}

function parseAnnotations(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [seconds, ...note] = line.split("|");
    return { positionMs: Math.max(0, Math.round(Number(seconds.trim()) * 1000)), note: note.join("|").trim() };
  });
}

export default function LearningWorkspaceClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [assignment, setAssignment] = useState({ studentGroupId: "", programmeId: "", title: "", brief: "", templateCode: "NEWS_60", dueAt: "", allowedTools: "AudioLab, Show Builder", openNow: true });
  const [submission, setSubmission] = useState({ assignmentId: "", contributorId: "", audioProjectId: "", episodeId: "", reflection: "", projectRole: "Presenter" });
  const [assessmentDrafts, setAssessmentDrafts] = useState({});

  const load = useCallback(async () => {
    const response = await fetch("/api/school-radio/learning", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The learning workspace could not be loaded.");
    setData(payload);
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);
  const selectedAssignment = useMemo(() => data?.assignments.find((item) => item.id === submission.assignmentId), [data, submission.assignmentId]);
  const selectedGroup = useMemo(() => data?.groups.find((item) => item.id === selectedAssignment?.studentGroupId), [data, selectedAssignment]);

  async function act(body, success) {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/school-radio/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The learning action could not be completed.");
      setNotice(success); await load(); return payload;
    } catch (actionError) { setError(actionError.message); return null; } finally { setWorking(false); }
  }

  async function createAssignment(event) {
    event.preventDefault();
    const result = await act({ action: "CREATE_ASSIGNMENT", ...assignment, programmeId: assignment.programmeId || null, dueAt: assignment.dueAt ? new Date(assignment.dueAt).toISOString() : null, allowedTools: assignment.allowedTools.split(",").map((item) => item.trim()).filter(Boolean), criteria: [] }, "Assignment and rubric created.");
    if (result) setAssignment({ studentGroupId: "", programmeId: "", title: "", brief: "", templateCode: "NEWS_60", dueAt: "", allowedTools: "AudioLab, Show Builder", openNow: true });
  }

  async function submitAssignment(event) {
    event.preventDefault();
    const result = await act({ action: "SUBMIT_ASSIGNMENT", assignmentId: submission.assignmentId, contributorIds: [submission.contributorId], audioProjectId: submission.audioProjectId || null, episodeId: submission.episodeId || null, reflection: submission.reflection || null, projectRoles: { [submission.contributorId]: submission.projectRole } }, "Submission recorded for teacher assessment.");
    if (result) setSubmission({ assignmentId: "", contributorId: "", audioProjectId: "", episodeId: "", reflection: "", projectRole: "Presenter" });
  }

  function draftFor(item) {
    return assessmentDrafts[item.id] || {
      scores: Object.fromEntries(item.assignment.rubric.criteria.map((criterion) => [criterion.id, item.assessment?.scores.find((score) => score.criterionId === criterion.id)?.score ?? ""])),
      narrativeNotes: item.assessment?.narrativeNotes || "",
      revisionRequest: item.assessment?.revisionRequest || "",
      annotations: (item.assessment?.annotations || []).map((annotation) => `${annotation.positionMs / 1000} | ${annotation.note}`).join("\n")
    };
  }

  async function assess(item) {
    const draft = draftFor(item);
    await act({ action: "ASSESS_SUBMISSION", submissionId: item.id, scores: item.assignment.rubric.criteria.map((criterion) => ({ criterionId: criterion.id, score: Number(draft.scores[criterion.id]), notes: null })), annotations: parseAnnotations(draft.annotations), narrativeNotes: draft.narrativeNotes || null, revisionRequest: draft.revisionRequest || null, release: true }, draft.revisionRequest ? "Assessment released with a revision request." : "Assessment released.");
  }

  async function addPortfolio(item, contributor) {
    const title = window.prompt("Private portfolio title:", item.assignment.title);
    if (!title?.trim()) return;
    const reflection = window.prompt("Teacher portfolio note (optional):", item.reflection || "") || "";
    const skills = window.prompt("Skills demonstrated, separated by commas:", item.assignment.rubric.criteria.map((criterion) => criterion.label).join(", ")) || "";
    await act({ action: "ADD_PORTFOLIO_ENTRY", submissionId: item.id, contributorId: contributor.id, title, projectRole: item.contributors.find((entry) => entry.contributorId === contributor.id)?.projectRole || null, reflection, skills: skills.split(",").map((skill) => skill.trim()).filter(Boolean) }, "Private portfolio evidence saved.");
  }

  if (!data) return <section style={styles.shell}><p>{error || "Loading Learning Workspace…"}</p></section>;
  const submissions = data.assignments.flatMap((item) => item.submissions.map((submissionItem) => ({ ...submissionItem, assignment: item })));

  return <section style={styles.shell}>
    <div style={styles.heading}><div><p style={styles.eyebrow}>STAGE 5A · LEARNING WORKSPACE</p><h2 style={styles.title}>Teach, assess, and preserve learning evidence</h2><p style={styles.muted}>Teachers issue class assignments, link AudioLab or episode work, assess against a rubric, add time-coded feedback, and keep portfolios private.</p></div><Badge value="STAFF MANAGED" /></div>
    {error ? <div style={styles.error}>{error}</div> : null}{notice ? <div style={styles.notice}>{notice}</div> : null}

    <div style={styles.columns}>
      <form onSubmit={createAssignment} style={styles.card}><p style={styles.eyebrow}>1 · ASSIGN</p><h3>Create class assignment</h3><label style={styles.label}>Class / group<select style={styles.input} value={assignment.studentGroupId} onChange={(event) => setAssignment({ ...assignment, studentGroupId: event.target.value, programmeId: "" })} required><option value="">Choose class…</option>{data.groups.map((item) => <option key={item.id} value={item.id}>{item.name}{item.academicYear ? ` · ${item.academicYear}` : ""}</option>)}</select></label><label style={styles.label}>Template<select style={styles.input} value={assignment.templateCode} onChange={(event) => setAssignment({ ...assignment, templateCode: event.target.value })}>{data.templates.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label style={styles.label}>Programme (optional)<select style={styles.input} value={assignment.programmeId} onChange={(event) => setAssignment({ ...assignment, programmeId: event.target.value })}><option value="">No programme link</option>{data.programmes.filter((item) => !assignment.studentGroupId || !item.studentGroupId || item.studentGroupId === assignment.studentGroupId).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={styles.label}>Title<input style={styles.input} value={assignment.title} onChange={(event) => setAssignment({ ...assignment, title: event.target.value })} required /></label><label style={styles.label}>Teacher brief<textarea style={styles.textarea} value={assignment.brief} onChange={(event) => setAssignment({ ...assignment, brief: event.target.value })} /></label><div style={styles.columns}><label style={styles.label}>Due date<input type="datetime-local" style={styles.input} value={assignment.dueAt} onChange={(event) => setAssignment({ ...assignment, dueAt: event.target.value })} /></label><label style={styles.label}>Allowed tools<input style={styles.input} value={assignment.allowedTools} onChange={(event) => setAssignment({ ...assignment, allowedTools: event.target.value })} /></label></div><label style={styles.check}><input type="checkbox" checked={assignment.openNow} onChange={(event) => setAssignment({ ...assignment, openNow: event.target.checked })} /> Open for staff-recorded submissions now</label><button style={styles.primary} disabled={working || !data.groups.length}>Create assignment + rubric</button>{!data.groups.length ? <p style={styles.warning}>Create a class and contributors in the School Editorial section first.</p> : null}</form>

      <form onSubmit={submitAssignment} style={styles.card}><p style={styles.eyebrow}>2 · SUBMIT</p><h3>Record student work</h3><label style={styles.label}>Open assignment<select style={styles.input} value={submission.assignmentId} onChange={(event) => setSubmission({ ...submission, assignmentId: event.target.value, contributorId: "" })} required><option value="">Choose assignment…</option>{data.assignments.filter((item) => item.status === "OPEN").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label style={styles.label}>Contributor<select style={styles.input} value={submission.contributorId} onChange={(event) => setSubmission({ ...submission, contributorId: event.target.value })} required><option value="">Choose contributor…</option>{(selectedGroup?.contributors || []).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label><label style={styles.label}>AudioLab project<select style={styles.input} value={submission.audioProjectId} onChange={(event) => setSubmission({ ...submission, audioProjectId: event.target.value })}><option value="">No project link</option>{data.audioProjects.filter((item) => !selectedAssignment || !item.studentGroupId || item.studentGroupId === selectedAssignment.studentGroupId).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}</select></label><label style={styles.label}>School episode<select style={styles.input} value={submission.episodeId} onChange={(event) => setSubmission({ ...submission, episodeId: event.target.value })}><option value="">No episode link</option>{data.episodes.filter((item) => !selectedAssignment || !item.programme.studentGroupId || item.programme.studentGroupId === selectedAssignment.studentGroupId).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}</select></label><label style={styles.label}>Project role<input style={styles.input} value={submission.projectRole} onChange={(event) => setSubmission({ ...submission, projectRole: event.target.value })} /></label><label style={styles.label}>Reflection / submission note<textarea style={styles.textarea} value={submission.reflection} onChange={(event) => setSubmission({ ...submission, reflection: event.target.value })} /></label><button style={styles.primary} disabled={working || !submission.assignmentId || !submission.contributorId || (!submission.audioProjectId && !submission.episodeId)}>Record submission</button></form>
    </div>

    <div style={styles.divider} />
    <div style={styles.list}>{data.assignments.map((item) => <article key={item.id} style={styles.card}><div style={styles.row}><div><h3 style={styles.itemTitle}>{item.title}</h3><p style={styles.muted}>{item.studentGroup.name} · {data.templates.find((template) => template.code === item.templateCode)?.label || item.templateCode}{item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleString()}` : ""}</p></div><Badge value={item.status} /></div>{item.brief ? <p style={styles.body}>{item.brief}</p> : null}<p style={styles.muted}>Rubric: {item.rubric.criteria.map((criterion) => `${criterion.label} /${criterion.maxScore}`).join(" · ")}</p><div style={styles.actions}>{item.status === "DRAFT" ? <button style={styles.primary} disabled={working} onClick={() => act({ action: "SET_ASSIGNMENT_STATUS", assignmentId: item.id, status: "OPEN" }, "Assignment opened.")}>Open</button> : null}{item.status === "OPEN" ? <button style={styles.secondary} disabled={working} onClick={() => act({ action: "SET_ASSIGNMENT_STATUS", assignmentId: item.id, status: "CLOSED" }, "Assignment closed.")}>Close submissions</button> : null}{item.status === "CLOSED" ? <button style={styles.secondary} disabled={working} onClick={() => act({ action: "SET_ASSIGNMENT_STATUS", assignmentId: item.id, status: "OPEN" }, "Assignment reopened.")}>Reopen</button> : null}</div></article>)}</div>

    <div style={styles.divider} />
    <h3>Assessment queue</h3><div style={styles.list}>{submissions.length ? submissions.map((item) => { const draft = draftFor(item); return <article key={item.id} style={styles.card}><div style={styles.row}><div><h3 style={styles.itemTitle}>{item.assignment.title} · revision {item.revision}</h3><p style={styles.muted}>{item.contributors.map((entry) => entry.contributor.displayName).join(", ")} · {item.audioProject?.title || item.episode?.title}</p></div><Badge value={item.status} /></div><div style={styles.scoreGrid}>{item.assignment.rubric.criteria.map((criterion) => <label key={criterion.id} style={styles.label}>{criterion.label} / {criterion.maxScore}<input type="number" min="0" max={criterion.maxScore} style={styles.input} value={draft.scores[criterion.id]} onChange={(event) => setAssessmentDrafts({ ...assessmentDrafts, [item.id]: { ...draft, scores: { ...draft.scores, [criterion.id]: event.target.value } } })} /></label>)}</div><label style={styles.label}>Teacher assessment<textarea style={styles.textarea} value={draft.narrativeNotes} onChange={(event) => setAssessmentDrafts({ ...assessmentDrafts, [item.id]: { ...draft, narrativeNotes: event.target.value } })} /></label><label style={styles.label}>Time-coded feedback — one line: seconds | note<textarea style={styles.textarea} value={draft.annotations} onChange={(event) => setAssessmentDrafts({ ...assessmentDrafts, [item.id]: { ...draft, annotations: event.target.value } })} placeholder="12.5 | Reduce the music under this voice link." /></label><label style={styles.label}>Revision request (leave empty to assess as complete)<textarea style={styles.textarea} value={draft.revisionRequest} onChange={(event) => setAssessmentDrafts({ ...assessmentDrafts, [item.id]: { ...draft, revisionRequest: event.target.value } })} /></label><div style={styles.actions}><button style={styles.approve} disabled={working || Object.values(draft.scores).some((value) => value === "")} onClick={() => assess(item)}>Release assessment</button>{item.status === "ASSESSED" ? item.contributors.map((entry) => <button key={entry.contributorId} style={styles.secondary} disabled={working} onClick={() => addPortfolio(item, entry.contributor)}>Add {entry.contributor.displayName} to private portfolio</button>) : null}</div></article>; }) : <p style={styles.muted}>No submissions are waiting for assessment.</p>}</div>

    <div style={styles.divider} />
    <h3>Private portfolios</h3><div style={styles.portfolioGrid}>{data.portfolios.map((item) => <article key={item.id} style={styles.card}><div style={styles.row}><div><h3 style={styles.itemTitle}>{item.title}</h3><p style={styles.muted}>{item.contributor.displayName} · {item.contributor.studentGroup.name}</p></div><Badge value="PRIVATE" /></div><p style={styles.body}>{item.submission.assignment.title}{item.projectRole ? ` · ${item.projectRole}` : ""}</p>{item.reflection ? <p style={styles.muted}>{item.reflection}</p> : null}<p style={styles.muted}>Skills: {(Array.isArray(item.skillsJson) ? item.skillsJson : []).join(", ") || "Not recorded"}</p></article>)}</div>
    <p style={styles.privacy}>Safety boundary: teachers act on behalf of students · no student accounts · no private messaging · portfolios cannot be published.</p>
  </section>;
}

const styles = {
  shell: { margin: "0 0 24px", border: "1px solid #2b3a54", borderRadius: 16, background: "#121d30", padding: 22 }, heading: { display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 18 }, title: { margin: "0 0 8px", fontSize: 28 }, itemTitle: { margin: "0 0 5px" },
  eyebrow: { color: "#f4b942", fontSize: 12, fontWeight: 900, letterSpacing: 1.1, margin: "0 0 7px" }, muted: { color: "#aebbd0", lineHeight: 1.5, margin: "6px 0" }, body: { color: "#dce5f3", lineHeight: 1.5 }, warning: { color: "#fed7aa", borderLeft: "3px solid #fb923c", paddingLeft: 10, lineHeight: 1.5 }, privacy: { color: "#8ea0b8", fontSize: 12, marginTop: 18 },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }, scoreGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }, portfolioGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 }, list: { display: "grid", gap: 14, marginTop: 14 }, card: { border: "1px solid #34445f", borderRadius: 12, background: "#18243a", padding: 17 }, row: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  label: { display: "grid", gap: 6, marginBottom: 11, color: "#dce5f3", fontWeight: 800, fontSize: 13 }, check: { display: "flex", alignItems: "center", gap: 8, color: "#dce5f3", margin: "10px 0", fontWeight: 800, fontSize: 13 }, input: { width: "100%", boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: "10px 11px", font: "inherit" }, textarea: { width: "100%", minHeight: 76, boxSizing: "border-box", border: "1px solid #61708a", borderRadius: 8, background: "#fff", color: "#111827", padding: 10, font: "inherit" },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }, primary: { border: 0, borderRadius: 8, background: "#f4b942", color: "#101827", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, approve: { border: 0, borderRadius: 8, background: "#22c55e", color: "#052e16", padding: "10px 13px", fontWeight: 900, cursor: "pointer" }, secondary: { border: "1px solid #94a3b8", borderRadius: 8, background: "transparent", color: "#e2e8f0", padding: "9px 12px", fontWeight: 800, cursor: "pointer" }, badge: { display: "inline-block", borderRadius: 6, background: "#263550", color: "#f8d78a", padding: "5px 8px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }, divider: { height: 1, background: "#34445f", margin: "26px 0" }, error: { border: "1px solid #ef4444", background: "#451a1a", color: "#fecaca", borderRadius: 8, padding: 12, marginBottom: 14 }, notice: { border: "1px solid #22c55e", background: "#052e16", color: "#bbf7d0", borderRadius: 8, padding: 12, marginBottom: 14 }
};
