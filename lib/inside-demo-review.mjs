export function initialInsideDemoReview() {
  return { status: "DRAFT", revision: 1, history: [] };
}

function renderId(revision) {
  return `SYNTHETIC-RENDER-${String(revision).padStart(3, "0")}`;
}

export function applyInsideDemoReview(state, action) {
  if (action === "RESET") return initialInsideDemoReview();

  if (action === "SUBMIT" && ["DRAFT", "CHANGES_REQUESTED"].includes(state.status)) {
    const revision = state.status === "CHANGES_REQUESTED" ? state.revision + 1 : state.revision;
    return {
      status: "PENDING_REVIEW",
      revision,
      history: [...state.history, { action, revision, renderId: renderId(revision), actor: "Contributor", label: `Version ${revision} submitted for review` }]
    };
  }

  if (state.status !== "PENDING_REVIEW" || !["REQUEST_CHANGES", "APPROVE", "REJECT"].includes(action)) return state;

  const status = {
    REQUEST_CHANGES: "CHANGES_REQUESTED",
    APPROVE: "APPROVED",
    REJECT: "REJECTED"
  }[action];
  const label = {
    REQUEST_CHANGES: `Staff requested changes to version ${state.revision}`,
    APPROVE: `Staff approved version ${state.revision}; nothing is scheduled`,
    REJECT: `Staff rejected version ${state.revision}`
  }[action];
  return {
    ...state,
    status,
    history: [...state.history, { action, revision: state.revision, renderId: renderId(state.revision), actor: "Authorised staff", label }]
  };
}
