const MANAGER_ROLES = new Set(["OWNER", "MANAGER"]);

function orderedSteps(items) {
  const firstIncomplete = items.findIndex((item) => !item.complete);
  return items.map((item, index) => ({
    ...item,
    status: item.complete
      ? "COMPLETE"
      : index === firstIncomplete
        ? "CURRENT"
        : "UPCOMING"
  }));
}

export function buildSubscriberOnboarding({
  serviceEnabled = true,
  membershipRole = "VIEWER",
  firstStationId = null,
  stationReady = false,
  activeLocationCount = 0,
  activeMusicModeCount = 0,
  publishedScheduleCount = 0,
  configuredPlayerCount = 0,
  activePlayerStreams = 0
} = {}) {
  const canManage = MANAGER_ROLES.has(membershipRole);
  const programmeReady = activeMusicModeCount > 0 && publishedScheduleCount > 0;
  const steps = orderedSteps([
    {
      id: "STATION",
      label: "Create and connect your station",
      detail: stationReady
        ? "Your station is active and ready to supply audio."
        : "Create the station, then complete its private streaming connection.",
      owner: canManage ? "Your task" : "Owner or manager",
      complete: stationReady,
      href: firstStationId
        ? `/stations/${firstStationId}`
        : canManage
          ? "/stations/new"
          : "/dashboard/notifications",
      actionLabel: firstStationId
        ? "Open station"
        : canManage
          ? "Create station"
          : "Check notifications"
    },
    {
      id: "LOCATION",
      label: "Prepare the listening location",
      detail: activeLocationCount > 0
        ? "At least one active shop or listening location is available."
        : "Ruvanas prepares the shop and listening zone before player enrolment.",
      owner: "Ruvanas setup",
      complete: activeLocationCount > 0,
      href: "/dashboard/players",
      actionLabel: "Check shop setup"
    },
    {
      id: "PROGRAMME",
      label: "Confirm music and schedule",
      detail: programmeReady
        ? "An active music mode and published schedule are ready."
        : "Ruvanas prepares the approved music mode and weekly schedule.",
      owner: "Ruvanas setup",
      complete: programmeReady,
      href: "/dashboard/notifications",
      actionLabel: "Check notifications"
    },
    {
      id: "PLAYER",
      label: "Prepare the shop player",
      detail: configuredPlayerCount > 0
        ? "A secure player has been prepared for this organisation."
        : "Create one enrolled player for the shop or listening zone.",
      owner: canManage ? "Your task" : "Owner or manager",
      complete: configuredPlayerCount > 0,
      href: "/dashboard/players",
      actionLabel: canManage ? "Prepare player" : "View player status"
    },
    {
      id: "PLAYBACK",
      label: "Confirm live playback",
      detail: activePlayerStreams > 0
        ? "A player is online and currently using a live stream slot."
        : "Bring the enrolled device online and confirm recent playback evidence.",
      owner: "Live evidence",
      complete: activePlayerStreams > 0,
      href: activePlayerStreams > 0 ? "/dashboard/player-sessions" : "/dashboard/players",
      actionLabel: activePlayerStreams > 0 ? "View live streams" : "Check player readiness"
    }
  ]);

  const completedCount = steps.filter((step) => step.complete).length;
  const nextStep = steps.find((step) => !step.complete) || steps.at(-1);
  const complete = completedCount === steps.length;

  const nextAction = !serviceEnabled
    ? {
        eyebrow: "SERVICE ATTENTION",
        title: "Review your service notifications",
        description: "Your radio tools are currently limited. Review the latest service message before continuing setup.",
        href: "/dashboard/notifications",
        label: "Review notifications"
      }
    : complete
      ? {
          eyebrow: "RADIO LIVE",
          title: "Your shop radio is running",
          description: "All first-use checks are complete. Review live streams or use the full tools below when you want to make changes.",
          href: "/dashboard/player-sessions",
          label: "View live streams"
        }
      : {
          eyebrow: "YOUR NEXT STEP",
          title: nextStep.label,
          description: nextStep.detail,
          href: nextStep.href,
          label: nextStep.actionLabel
        };

  return {
    complete,
    completedCount,
    totalCount: steps.length,
    nextStepId: complete ? null : nextStep.id,
    steps,
    nextAction
  };
}
