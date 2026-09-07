export const STUDIO_EXPERIENCE_MODES = Object.freeze(["BEGINNER", "ADVANCED"]);

export function normalizeStudioExperienceMode(value) {
  return value === "ADVANCED" ? "ADVANCED" : "BEGINNER";
}

export function studioToolForProject(project = {}) {
  if (project.type === "MULTITRACK") return "multitrack";
  return Array.isArray(project.takes) && project.takes.length ? "waveform" : "record";
}

export function summarizeStudioProjects(projects = []) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const ordered = [...safeProjects].sort((left, right) => {
    const leftTime = new Date(left?.updatedAt || left?.createdAt || 0).getTime();
    const rightTime = new Date(right?.updatedAt || right?.createdAt || 0).getTime();
    return rightTime - leftTime;
  });

  return {
    total: ordered.length,
    quickRecord: ordered.filter((project) => project.type !== "MULTITRACK").length,
    multitrack: ordered.filter((project) => project.type === "MULTITRACK").length,
    ready: ordered.filter((project) => new Set(["READY", "SUBMITTED"]).has(project.status)).length,
    recent: ordered.slice(0, 12).map((project) => ({
      ...project,
      tool: studioToolForProject(project)
    }))
  };
}
