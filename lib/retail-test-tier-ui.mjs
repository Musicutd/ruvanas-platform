export const retailTestTierInitialState = Object.freeze({ data: null, selectedCode: "", busy: "load", error: "", message: "", needsReload: false });

export function retailTestTierResponse(body) {
  if (!body || body.ok !== true || body.freeTest !== true || !Array.isArray(body.plans) || body.plans.length !== 5 ||
    !body.plans.every(plan => typeof plan.code === "string" && /^RETAIL_[A-Z_]+$/.test(plan.code) && typeof plan.name === "string" && plan.limits &&
      ["locations", "players", "storageGb", "bitrateKbps"].every(key => Number.isFinite(plan.limits[key]) && plan.limits[key] >= 0) &&
      plan.digitalDisplaysEnabled === false && plan.monthlyPriceCents === 0) ||
    new Set(body.plans.map(plan => plan.code)).size !== 5 ||
    !(body.revision === null || typeof body.revision === "string") ||
    (body.currentPlan !== null && !body.plans.some(plan => plan.code === body.currentPlan?.code))) {
    throw new Error("The test tiers could not be confirmed. Reload the current tier before making a change.");
  }
  return body;
}

export function retailTestTierReducer(state, event) {
  if (event.type === "load-start") return { ...state, busy: "load", error: "", message: "" };
  if (event.type === "loaded") return { ...state, data: event.data, busy: "", error: "", needsReload: false,
    selectedCode: event.data.plans.some(plan => plan.code === state.selectedCode) ? state.selectedCode : event.data.currentPlan?.code || "" };
  if (event.type === "load-failed") return { ...state, busy: "", error: event.error, needsReload: true };
  if (event.type === "select" && !state.busy && state.data?.plans.some(plan => plan.code === event.code)) return { ...state, selectedCode: event.code, message: "" };
  if (event.type === "apply-start") return { ...state, busy: "save", error: "", message: "" };
  if (event.type === "applied") return { ...state, data: event.data, selectedCode: event.data.currentPlan?.code || state.selectedCode,
    busy: "", error: "", needsReload: false, message: event.data.changed === false ? "This test tier is already selected." : `${event.data.currentPlan?.name || "The selected tier"} is now selected for testing. Your stream settings are unchanged.` };
  if (event.type === "apply-failed") return { ...state, busy: "", error: event.error, needsReload: true };
  return state;
}

export function retailTestTierSelection(state) {
  const plan = state.data?.plans.find(item => item.code === state.selectedCode) || null;
  const usage = state.data?.usage || {};
  const warnings = [];
  if (plan && Number.isFinite(usage.locations) && usage.locations > plan.limits.locations) warnings.push("You already have more shops than this test tier allows. Existing shops stay saved; adding more will be limited.");
  if (plan && Number.isFinite(usage.players) && usage.players > plan.limits.players) warnings.push("You already have more devices than this test tier allows. Existing devices stay saved; new device setup will be limited.");
  if (plan && Number.isFinite(usage.storageBytes) && usage.storageBytes > plan.limits.storageGb * 1_000_000_000) warnings.push("Your saved files exceed this test tier’s storage allowance. Files stay saved; further uploads will be limited.");
  return { plan, warnings, canApply: Boolean(plan && !state.busy && !state.needsReload && plan.code !== state.data?.currentPlan?.code) };
}
