export const ASSIGNMENT_TEMPLATES = Object.freeze([
  { code: "NEWS_60", label: "60-second news report", criteria: ["Accuracy", "Clarity", "Timing"] },
  { code: "INTERVIEW", label: "Interview and edited interview", criteria: ["Preparation", "Interview technique", "Editing"] },
  { code: "MUSIC_SHOW", label: "Five-minute music show with voice links", criteria: ["Structure", "Voice links", "Technical finish"] },
  { code: "PODCAST", label: "Podcast episode", criteria: ["Storytelling", "Production", "Accessibility"] },
  { code: "PSA", label: "Public-service announcement / advert", criteria: ["Message", "Audience fit", "Production"] },
  { code: "DOCUMENTARY", label: "Historical audio documentary", criteria: ["Research", "Narrative", "Source use"] },
  { code: "LANGUAGE", label: "Language-learning programme", criteria: ["Language accuracy", "Teaching value", "Presentation"] },
  { code: "SOUNDSCAPE", label: "Soundscape / creative audio", criteria: ["Concept", "Sound design", "Technical finish"] },
  { code: "SPORTS", label: "Sports commentary package", criteria: ["Accuracy", "Commentary", "Editing"] },
  { code: "EVENT_RECAP", label: "School-event recap", criteria: ["Coverage", "Structure", "Production"] }
]);

export const ASSIGNMENT_TEMPLATE_CODES = Object.freeze(ASSIGNMENT_TEMPLATES.map((item) => item.code));

function cleanText(value, maximum = 1000) {
  return String(value || "").trim().slice(0, maximum);
}

export function defaultRubricForTemplate(templateCode) {
  const template = ASSIGNMENT_TEMPLATES.find((item) => item.code === templateCode);
  if (!template) throw new Error("Choose a supported assignment template.");
  return template.criteria.map((label, index) => ({ label, description: null, maxScore: 10, position: index + 1 }));
}

export function normalizeRubricCriteria(value, templateCode) {
  const source = Array.isArray(value) && value.length ? value : defaultRubricForTemplate(templateCode);
  if (!source.length || source.length > 12) throw new Error("A rubric needs between one and twelve criteria.");
  const criteria = source.map((item, index) => {
    const label = cleanText(item?.label, 120);
    const description = cleanText(item?.description, 500) || null;
    const maxScore = Math.round(Number(item?.maxScore));
    if (!label) throw new Error(`Rubric criterion ${index + 1} needs a label.`);
    if (!Number.isInteger(maxScore) || maxScore < 1 || maxScore > 100) throw new Error(`Rubric criterion ${index + 1} needs a maximum score from 1 to 100.`);
    return { label, description, maxScore, position: index + 1 };
  });
  if (criteria.reduce((sum, item) => sum + item.maxScore, 0) > 500) throw new Error("The rubric maximum cannot exceed 500 points.");
  return criteria;
}

export function validateAssignmentWindow({ dueAt }) {
  if (!dueAt) return null;
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(due.getTime())) throw new Error("Choose a valid assignment due date.");
  return due;
}

export function validateAssignmentSubmission({ assignmentStatus, contributorIds, audioProjectId, episodeId }) {
  if (assignmentStatus !== "OPEN") throw new Error("Submissions are accepted only while the assignment is open.");
  const contributors = [...new Set(Array.isArray(contributorIds) ? contributorIds.filter(Boolean) : [])];
  if (!contributors.length || contributors.length > 20) throw new Error("Choose at least one and no more than twenty contributors.");
  if (!audioProjectId && !episodeId) throw new Error("Link an AudioLab project or school episode to the submission.");
  return contributors;
}

export function normalizeAssessment({ criteria, scores, annotations = [], narrativeNotes, revisionRequest }) {
  const criterionMap = new Map((criteria || []).map((item) => [item.id, item]));
  if (!criterionMap.size) throw new Error("This assignment does not have a rubric.");
  if (!Array.isArray(scores) || scores.length !== criterionMap.size) throw new Error("Score every rubric criterion before saving the assessment.");
  const seen = new Set();
  const normalizedScores = scores.map((item) => {
    const criterion = criterionMap.get(item?.criterionId);
    const score = Math.round(Number(item?.score));
    if (!criterion || seen.has(criterion.id)) throw new Error("Assessment scores must match the assignment rubric exactly once.");
    if (!Number.isInteger(score) || score < 0 || score > criterion.maxScore) throw new Error(`The score for ${criterion.label} must be between 0 and ${criterion.maxScore}.`);
    seen.add(criterion.id);
    return { criterionId: criterion.id, score, notes: cleanText(item?.notes, 1000) || null };
  });
  const normalizedAnnotations = (Array.isArray(annotations) ? annotations : []).slice(0, 100).map((item, index) => {
    const positionMs = Math.max(0, Math.round(Number(item?.positionMs) || 0));
    const endMs = item?.endMs === null || item?.endMs === undefined || item?.endMs === "" ? null : Math.max(positionMs, Math.round(Number(item.endMs) || 0));
    const note = cleanText(item?.note, 2000);
    if (!note) throw new Error(`Time-coded feedback ${index + 1} needs a note.`);
    return { positionMs, endMs, note };
  }).sort((left, right) => left.positionMs - right.positionMs);
  return {
    scores: normalizedScores,
    annotations: normalizedAnnotations,
    totalScore: normalizedScores.reduce((sum, item) => sum + item.score, 0),
    maximumScore: [...criterionMap.values()].reduce((sum, item) => sum + item.maxScore, 0),
    narrativeNotes: cleanText(narrativeNotes, 5000) || null,
    revisionRequest: cleanText(revisionRequest, 3000) || null
  };
}

export function normalizePortfolioEvidence({ title, projectRole, reflection, skills }) {
  const cleanTitle = cleanText(title, 160);
  if (!cleanTitle) throw new Error("Portfolio evidence needs a title.");
  const normalizedSkills = [...new Set((Array.isArray(skills) ? skills : []).map((item) => cleanText(item, 80)).filter(Boolean))].slice(0, 20);
  return { title: cleanTitle, projectRole: cleanText(projectRole, 120) || null, reflection: cleanText(reflection, 3000) || null, skills: normalizedSkills, status: "PRIVATE" };
}
