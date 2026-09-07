"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeStudioExperienceMode, summarizeStudioProjects } from "@/lib/studio-workspace.mjs";
import AudioLabClient from "./AudioLabClient";
import WaveformEditorClient from "./WaveformEditorClient";
import MultitrackStudioClient from "./MultitrackStudioClient";
import styles from "./studio-workspace.module.css";

const tools = [
  { id: "projects", label: "Projects", description: "Recent work and progress" },
  { id: "record", label: "Record", description: "Create or retake audio" },
  { id: "waveform", label: "Waveform", description: "Precision single-file edits" },
  { id: "multitrack", label: "Multitrack", description: "Voice, music and jingles" }
];

const projectTypeLabels = {
  QUICK_RECORD: "Quick Record",
  VOICE_TRACK: "Voice track",
  MULTITRACK: "Multitrack"
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not saved yet";
}

export default function StudioWorkspaceClient() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [activeTool, setActiveTool] = useState("projects");
  const [visited, setVisited] = useState(() => new Set(["projects"]));
  const [requestedProjectId, setRequestedProjectId] = useState("");
  const [experienceMode, setExperienceMode] = useState("BEGINNER");
  const tabRefs = useRef([]);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/school-radio/audio-lab", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Studio projects could not be loaded.");
    setData(payload);
    setError("");
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("ruvanas:studio-experience");
    setExperienceMode(normalizeStudioExperienceMode(stored));
    loadProjects().catch((loadError) => setError(loadError.message));
  }, [loadProjects]);

  useEffect(() => {
    const refresh = () => loadProjects().catch((loadError) => setError(loadError.message));
    window.addEventListener("ruvanas:studio-projects-refresh", refresh);
    return () => window.removeEventListener("ruvanas:studio-projects-refresh", refresh);
  }, [loadProjects]);

  const summary = useMemo(() => summarizeStudioProjects(data?.projects), [data]);

  function selectTool(toolId, projectId = "") {
    setRequestedProjectId(projectId);
    setActiveTool(toolId);
    setVisited((current) => new Set([...current, toolId]));
  }

  function changeMode(mode) {
    const nextMode = normalizeStudioExperienceMode(mode);
    setExperienceMode(nextMode);
    window.localStorage.setItem("ruvanas:studio-experience", nextMode);
  }

  function openProject(project) {
    selectTool(project.tool, project.id);
  }

  function handleTabKeyDown(event, index) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tools.length - 1
        : event.key === "ArrowRight"
          ? (index + 1) % tools.length
          : (index - 1 + tools.length) % tools.length;
    selectTool(tools[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className={styles.workspace} aria-labelledby="ruvanas-studio-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>RUVANAS STUDIO</p>
          <h2 id="ruvanas-studio-title">Make polished audio one step at a time</h2>
          <p>Start with Projects if you are unsure. Your recordings, edits and mixes continue to use the existing protected Ruvanas audio system.</p>
        </div>
        <div className={styles.modeControl} aria-label="Studio experience">
          <span>Experience</span>
          <div>
            <button type="button" aria-pressed={experienceMode === "BEGINNER"} onClick={() => changeMode("BEGINNER")}>Beginner</button>
            <button type="button" aria-pressed={experienceMode === "ADVANCED"} onClick={() => changeMode("ADVANCED")}>Advanced</button>
          </div>
        </div>
      </header>

      <div className={styles.safetyStrip}>
        <strong>Non-destructive by default</strong>
        <span>Original audio stays unchanged. Studio saves edit decisions and renders final output on the server.</span>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Ruvanas Studio tools">
        {tools.map((tool, index) => {
          const selected = activeTool === tool.id;
          return <button
            key={tool.id}
            ref={(node) => { tabRefs.current[index] = node; }}
            type="button"
            id={`studio-${tool.id}-tab`}
            role="tab"
            aria-selected={selected}
            aria-controls={`studio-${tool.id}-panel`}
            tabIndex={selected ? 0 : -1}
            className={selected ? styles.activeTab : styles.tab}
            onClick={() => selectTool(tool.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <span>{tool.label}</span>
            <small>{tool.description}</small>
          </button>;
        })}
      </div>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      {visited.has("projects") ? <div id="studio-projects-panel" role="tabpanel" aria-labelledby="studio-projects-tab" hidden={activeTool !== "projects"} className={styles.panel}>
        <div className={styles.summaryGrid} aria-label="Studio project summary">
          <article><strong>{summary.total}</strong><span>Active projects</span></article>
          <article><strong>{summary.quickRecord}</strong><span>Recordings and voice tracks</span></article>
          <article><strong>{summary.multitrack}</strong><span>Multitrack productions</span></article>
          <article><strong>{summary.ready}</strong><span>Ready or submitted</span></article>
        </div>

        <div className={styles.projectHeading}>
          <div><h3>Recent projects</h3><p>Open the right tool without searching through the full School Radio page.</p></div>
          <button type="button" className={styles.primaryButton} onClick={() => selectTool("record")}>New recording</button>
        </div>

        {!data ? <p className={styles.empty}>Loading your Studio projects…</p> : !summary.recent.length ? <div className={styles.empty}><strong>No Studio projects yet</strong><span>Create a recording first, or open Multitrack for a voice-and-music production.</span><div><button type="button" onClick={() => selectTool("record")}>Start a recording</button><button type="button" onClick={() => selectTool("multitrack")}>Start a multitrack project</button></div></div> : <div className={styles.projectList}>
          {summary.recent.map((project) => <article key={project.id} className={styles.projectCard}>
            <div>
              <span className={styles.projectType}>{projectTypeLabels[project.type] || "Audio project"}</span>
              <h3>{project.title}</h3>
              <p>{project.status.replaceAll("_", " ")} · Version {project.currentVersion} · Updated {formatDate(project.updatedAt)}</p>
              {project.programme?.title || project.episode?.title ? <small>{project.programme?.title || "No programme"}{project.episode?.title ? ` · ${project.episode.title}` : ""}</small> : null}
            </div>
            <button type="button" onClick={() => openProject(project)}>Open {project.tool === "record" ? "recording" : project.tool}</button>
          </article>)}
        </div>}
      </div> : null}

      {visited.has("record") ? <div id="studio-record-panel" role="tabpanel" aria-labelledby="studio-record-tab" hidden={activeTool !== "record"} className={styles.panel}>
        <AudioLabClient requestedProjectId={requestedProjectId} experienceMode={experienceMode} onExperienceModeChange={changeMode} />
      </div> : null}
      {visited.has("waveform") ? <div id="studio-waveform-panel" role="tabpanel" aria-labelledby="studio-waveform-tab" hidden={activeTool !== "waveform"} className={styles.panel}>
        <WaveformEditorClient requestedProjectId={requestedProjectId} experienceMode={experienceMode} onExperienceModeChange={changeMode} />
      </div> : null}
      {visited.has("multitrack") ? <div id="studio-multitrack-panel" role="tabpanel" aria-labelledby="studio-multitrack-tab" hidden={activeTool !== "multitrack"} className={styles.panel}>
        <MultitrackStudioClient requestedProjectId={requestedProjectId} experienceMode={experienceMode} onExperienceModeChange={changeMode} />
      </div> : null}
    </section>
  );
}
