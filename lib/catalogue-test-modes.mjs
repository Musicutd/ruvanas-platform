// Named owner-test scenarios only. These do not enable ordinary station output
// or add/edit a weekly schedule. The server still issues the separate grant.
export const HANDOVER_TEST_MODE = "HANDOVER_90_SECONDS";
export const HANDOVER_TEST_PHASES = Object.freeze(["AUTODJ", "SCHEDULED", "AUTODJ_RETURN"]);
export const HANDOVER_TEST_PHASE_LABELS = Object.freeze({ AUTODJ: "Random AutoDJ sample", SCHEDULED: "Programme sample", AUTODJ_RETURN: "Return to AutoDJ" });

export function catalogueTestMode(testMode, profileId = "FIVE_MINUTES") {
  if (!["FIVE_MINUTES", "ONE_HOUR"].includes(profileId)) return null;
  if (testMode === undefined || testMode === "STANDARD") return { id: "STANDARD" };
  if (testMode === HANDOVER_TEST_MODE && profileId === "FIVE_MINUTES") return {
    id: HANDOVER_TEST_MODE, maximumSeconds: 300, audioDurationSeconds: 90, phaseSeconds: 30,
    phases: HANDOVER_TEST_PHASES, maximumItems: 3
  };
  return null;
}
