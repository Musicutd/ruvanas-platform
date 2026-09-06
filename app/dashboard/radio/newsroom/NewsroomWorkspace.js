"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./newsroom.module.css";

const TYPE_LABELS = { NEWS_BULLETIN: "News bulletin", INTERVIEW: "Interview", SPORTS_RESULT: "Sports result", FEATURE_STORY: "Feature story", WEATHER: "Weather", TRAFFIC: "Traffic", COMMUNITY: "Community", BUSINESS: "Business", PUBLIC_SERVICE: "Public service" };
const NEXT_ACTION = { PITCH: "START_SCRIPT", ASSIGNED: "START_SCRIPT", SCRIPTING: "FACT_CHECK", FACT_CHECK: "START_AUDIO", AUDIO_PRODUCTION: "SUBMIT", APPROVED: "PUBLISH" };
const ACTION_LABELS = { START_SCRIPT: "Start scripting", FACT_CHECK: "Send to fact-check", START_AUDIO: "Start audio production", SUBMIT: "Submit for review", PUBLISH: "Release story" };

function linesToSources(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [label, url, ...notes] = line.split("|").map((part) => part.trim());
    return { label, url: url || null, notes: notes.join(" | ") || null };
  });
}

function sourcesToLines(sources) {
  return (Array.isArray(sources) ? sources : []).map((source) => [source.label, source.url, source.notes].filter(Boolean).join(" | ")).join("\n");
}

function StatusBadge({ status }) {
  return <span className={`${styles.badge} ${styles[String(status || "").toLowerCase()] || ""}`}>{String(status || "").replaceAll("_", " ")}</span>;
}

function EditorialForm({ story, data, onSaved, working }) {
  const [form, setForm] = useState({ script: story.script || "", factCheckNotes: story.factCheckNotes || "", sourcesText: sourcesToLines(story.sourcesJson), audioProjectId: story.audioProjectId || "", interviewMediaAssetId: story.interviewMediaAssetId || "", interviewConsentConfirmed: Boolean(story.interviewConsentConfirmed) });
  const locked = ["IN_REVIEW", "APPROVED", "PUBLISHED"].includes(story.status);
  async function submit(event) {
    event.preventDefault();
    await onSaved({ action: "SAVE", storyId: story.id, script: form.script, factCheckNotes: form.factCheckNotes, sources: linesToSources(form.sourcesText), audioProjectId: form.audioProjectId || null, interviewMediaAssetId: form.interviewMediaAssetId || null, interviewConsentConfirmed: form.interviewConsentConfirmed });
  }
  return <form className={styles.editor} onSubmit={submit}>
    <div className={styles.editorGrid}>
      <label className={styles.wide}>Broadcast script<textarea rows="9" value={form.script} onChange={(event) => setForm({ ...form, script: event.target.value })} disabled={locked} placeholder="Write the presenter-ready script…" /></label>
      <label>Fact-check notes<textarea rows="5" value={form.factCheckNotes} onChange={(event) => setForm({ ...form, factCheckNotes: event.target.value })} disabled={locked} placeholder="Record what was checked and when." /></label>
      <label>Sources — one per line<textarea rows="5" value={form.sourcesText} onChange={(event) => setForm({ ...form, sourcesText: event.target.value })} disabled={locked} placeholder="Source label | https://source.example | verification note" /></label>
      <label>Ruvanas Studio project<select value={form.audioProjectId} onChange={(event) => setForm({ ...form, audioProjectId: event.target.value })} disabled={locked}><option value="">No Studio project attached</option>{data.studioProjects.map((project) => <option key={project.id} value={project.id}>{project.title} · {project.status.replaceAll("_", " ")}</option>)}</select></label>
      <label>Interview recording<select value={form.interviewMediaAssetId} onChange={(event) => setForm({ ...form, interviewMediaAssetId: event.target.value })} disabled={locked}><option value="">No interview recording attached</option>{data.interviewAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name || asset.originalName}</option>)}</select></label>
      {form.interviewMediaAssetId ? <label className={styles.check}><input type="checkbox" checked={form.interviewConsentConfirmed} onChange={(event) => setForm({ ...form, interviewConsentConfirmed: event.target.checked })} disabled={locked} /> Interview recording consent is confirmed</label> : null}
    </div>
    <div className={styles.actions}>{!locked ? <button disabled={working}>Save revision</button> : <span className={styles.muted}>Reviewed content is locked. A manager must request changes before editing.</span>}<a href="/dashboard/studio">Open Ruvanas Studio</a></div>
  </form>;
}

export default function NewsroomWorkspace() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [expanded, setExpanded] = useState(null);
  const [assignees, setAssignees] = useState({});
  const [notes, setNotes] = useState({});
  const [draft, setDraft] = useState({ stationId: "", channelId: "", title: "", type: "NEWS_BULLETIN", pitch: "", deadline: "" });

  const load = useCallback(async () => {
    const response = await fetch("/api/newsroom", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Unable to load the newsroom.");
    setData(body);
    setDraft((current) => ({ ...current, stationId: current.stationId || body.stations[0]?.id || "" }));
  }, []);

  useEffect(() => { load().catch((loadError) => setError(loadError.message)); }, [load]);

  async function act(payload, success = "Newsroom updated.") {
    setWorking(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/newsroom", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The newsroom action could not be completed.");
      setNotice(body.notice || success); await load(); return true;
    } catch (actionError) { setError(actionError.message); return false; }
    finally { setWorking(false); }
  }

  const channels = useMemo(() => data?.channels.filter((channel) => channel.stationId === draft.stationId) || [], [data, draft.stationId]);
  const stories = useMemo(() => (data?.stories || []).filter((story) => {
    const matchesText = !query || `${story.title} ${story.pitch || ""} ${story.station?.name || ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesText && (status === "ALL" || story.status === status);
  }), [data, query, status]);

  if (!data) return <div className={styles.panel}>{error || "Loading the newsroom…"}</div>;
  const inReview = data.stories.filter((story) => story.status === "IN_REVIEW").length;
  const published = data.stories.filter((story) => story.status === "PUBLISHED").length;

  return <div className={styles.workspace}>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice}>{notice}</div> : null}
    <section className={styles.metrics} aria-label="Newsroom overview"><div><strong>{data.stories.length}</strong><span>Active stories</span></div><div><strong>{inReview}</strong><span>Awaiting review</span></div><div><strong>{published}</strong><span>Released stories</span></div><div><strong>{data.members.length}</strong><span>Editorial staff</span></div></section>

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>ASSIGNMENT DESK</p><h2>Pitch a station story</h2><p>Every story stays inside your organisation and begins as an unpublished pitch.</p></div><span>Manager release required</span></div>
      <form className={styles.createGrid} onSubmit={async (event) => { event.preventDefault(); const ok = await act({ action: "CREATE", ...draft, channelId: draft.channelId || null, deadline: draft.deadline ? new Date(draft.deadline).toISOString() : null }, "Story pitch created."); if (ok) setDraft({ stationId: data.stations[0]?.id || "", channelId: "", title: "", type: "NEWS_BULLETIN", pitch: "", deadline: "" }); }}>
        <label>Station<select required value={draft.stationId} onChange={(event) => setDraft({ ...draft, stationId: event.target.value, channelId: "" })}><option value="">Choose station…</option>{data.stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}</select></label>
        <label>Channel<select value={draft.channelId} onChange={(event) => setDraft({ ...draft, channelId: event.target.value })}><option value="">Station-wide story</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        <label>Story type<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{data.templates.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></label>
        <label>Deadline<input type="datetime-local" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} /></label>
        <label className={styles.wide}>Working title<input required minLength="3" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Morning local news" /></label>
        <label className={styles.wide}>Editorial pitch<textarea required minLength="10" rows="3" value={draft.pitch} onChange={(event) => setDraft({ ...draft, pitch: event.target.value })} placeholder="What is the story, why does it matter, and who is it for?" /></label>
        <button className={styles.primary} disabled={working || !data.stations.length}>Create pitch</button>
      </form>
      {!data.stations.length ? <p className={styles.guidance}>Create an Online Radio station before opening the assignment desk.</p> : null}
    </section>

    <section className={styles.panel}>
      <div className={styles.heading}><div><p className={styles.kicker}>EDITORIAL PIPELINE</p><h2>News desk</h2></div><span>{stories.length} shown</span></div>
      <div className={styles.filters}><input aria-label="Search stories" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stories…" /><select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All stages</option>{["PITCH", "ASSIGNED", "SCRIPTING", "FACT_CHECK", "AUDIO_PRODUCTION", "IN_REVIEW", "APPROVED", "PUBLISHED"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
      <div className={styles.storyList}>{stories.map((story) => {
        const next = NEXT_ACTION[story.status];
        return <article className={styles.story} key={story.id}>
          <button className={styles.storyHead} type="button" onClick={() => setExpanded(expanded === story.id ? null : story.id)} aria-expanded={expanded === story.id}>
            <div><span className={styles.type}>{TYPE_LABELS[story.type] || story.type}</span><h3>{story.title}</h3><p>{story.station?.name}{story.channel ? ` · ${story.channel.name}` : " · Station-wide"} · {story.assignedTo?.name || story.assignedTo?.email || "Unassigned"}</p></div>
            <div><StatusBadge status={story.status} /><span className={styles.revisions}>v{story.revisions[0]?.revision || 0}</span></div>
          </button>
          {expanded === story.id ? <div className={styles.storyBody}>
            <div className={styles.pitch}><strong>Pitch</strong><p>{story.pitch}</p>{story.deadline ? <small>Deadline: {new Date(story.deadline).toLocaleString()}</small> : null}</div>
            {story.status === "PITCH" && data.permissions.canReview ? <div className={styles.assignment}><select value={assignees[story.id] || ""} onChange={(event) => setAssignees({ ...assignees, [story.id]: event.target.value })}><option value="">Choose editor…</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.name || member.email} · {member.role.replaceAll("_", " ")}</option>)}</select><button disabled={working || !assignees[story.id]} onClick={() => act({ action: "ASSIGN", storyId: story.id, assigneeUserId: assignees[story.id] }, "Story assigned.")}>Assign story</button></div> : null}
            <EditorialForm key={`${story.id}-${story.updatedAt}`} story={story} data={data} working={working} onSaved={act} />
            <div className={styles.actions}>
              {next && story.status !== "IN_REVIEW" && (next !== "PUBLISH" || data.permissions.canReview) ? <button disabled={working} onClick={() => act({ action: next, storyId: story.id }, `${ACTION_LABELS[next]} completed.`)}>{ACTION_LABELS[next]}</button> : null}
              {story.status === "IN_REVIEW" && data.permissions.canReview ? <><button disabled={working} onClick={() => act({ action: "APPROVE", storyId: story.id }, "Story approved.")}>Approve</button><input value={notes[story.id] || ""} onChange={(event) => setNotes({ ...notes, [story.id]: event.target.value })} placeholder="Required feedback for changes" /><button className={styles.secondary} disabled={working || !(notes[story.id] || "").trim()} onClick={() => act({ action: "REQUEST_CHANGES", storyId: story.id, notes: notes[story.id] }, "Story returned with feedback.")}>Request changes</button></> : null}
              {data.permissions.canReview ? <button className={styles.quiet} disabled={working} onClick={() => act({ action: "ARCHIVE", storyId: story.id }, "Story archived.")}>Archive</button> : null}
            </div>
            <div className={styles.history}><div><strong>Revision history</strong>{story.revisions.length ? story.revisions.map((revision) => <span key={revision.id}>v{revision.revision} · {revision.createdBy.name || "Editor"} · {new Date(revision.createdAt).toLocaleString()}</span>) : <span>No saved script revision yet.</span>}</div><div><strong>Decision history</strong>{story.decisions.map((decision) => <span key={decision.id}>{decision.action.replaceAll("_", " ")} · {decision.actor.name || "Staff"} · {decision.toStatus.replaceAll("_", " ")}</span>)}</div></div>
          </div> : null}
        </article>;
      })}{!stories.length ? <div className={styles.empty}>No newsroom stories match this view.</div> : null}</div>
    </section>
  </div>;
}
