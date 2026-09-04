const MANAGER_ROLES = new Set(["OWNER", "MANAGER"]);

function orderedSteps(steps) {
  const firstIncomplete = steps.findIndex((step) => !step.complete);
  return steps.map((step, index) => ({
    ...step,
    status: step.complete
      ? "COMPLETE"
      : index === firstIncomplete
        ? "CURRENT"
        : "UPCOMING"
  }));
}

function finishProductOnboarding({ product, serviceEnabled, steps, completeAction }) {
  const ordered = orderedSteps(steps);
  const completedCount = ordered.filter((step) => step.complete).length;
  const complete = completedCount === ordered.length;
  const nextStep = ordered.find((step) => !step.complete) || null;

  const nextAction = !serviceEnabled
    ? {
        href: "/dashboard/account",
        label: "Review account access",
        title: `${product} access needs attention`,
        description: `Review the organisation plan before continuing ${product} setup.`
      }
    : complete
      ? completeAction
      : {
          href: nextStep.href,
          label: nextStep.actionLabel,
          title: nextStep.label,
          description: nextStep.detail
        };

  return Object.freeze({
    product,
    complete,
    completedCount,
    totalCount: ordered.length,
    percent: Math.round((completedCount / ordered.length) * 100),
    nextStepId: nextStep?.id || null,
    nextAction,
    steps: ordered
  });
}

function subscriberTask(canManage, manageLabel, viewLabel = "View status") {
  return canManage ? manageLabel : viewLabel;
}

export function buildRetailProductOnboarding({
  serviceEnabled = true,
  membershipRole = "VIEWER",
  activeLocationCount = 0,
  activeMusicModeCount = 0,
  publishedScheduleCount = 0,
  configuredPlayerCount = 0,
  activePlayerStreams = 0
} = {}) {
  const canManage = MANAGER_ROLES.has(membershipRole);
  const programmeReady = activeMusicModeCount > 0 && publishedScheduleCount > 0;

  return finishProductOnboarding({
    product: "Retail Radio",
    serviceEnabled,
    completeAction: {
      href: "/dashboard/player-sessions",
      label: "Monitor live locations",
      title: "Retail Radio is live",
      description: "Your first location has programming, an enrolled player and a current live session."
    },
    steps: [
      {
        id: "LOCATION",
        label: "Prepare a retail location",
        detail: activeLocationCount > 0
          ? "An active shop or customer space is available."
          : "A location and listening zone are required before a shop player can be prepared.",
        owner: "Ruvanas setup",
        complete: activeLocationCount > 0,
        href: "/dashboard/players",
        actionLabel: "Review location setup"
      },
      {
        id: "PROGRAMMING",
        label: "Publish the first programme",
        detail: programmeReady
          ? "An active music mode and published schedule are ready."
          : "Choose approved music and publish a schedule for the listening location.",
        owner: canManage ? "Your task" : "Owner or manager",
        complete: programmeReady,
        href: "/dashboard/programming",
        actionLabel: subscriberTask(canManage, "Open programming")
      },
      {
        id: "PLAYER",
        label: "Enrol a secure shop player",
        detail: configuredPlayerCount > 0
          ? "At least one secure player is prepared."
          : "Prepare and enrol the dedicated player used at the first location.",
        owner: canManage ? "Your task" : "Owner or manager",
        complete: configuredPlayerCount > 0,
        href: "/dashboard/players",
        actionLabel: subscriberTask(canManage, "Prepare player")
      },
      {
        id: "PLAYBACK",
        label: "Confirm live shop playback",
        detail: activePlayerStreams > 0
          ? "A player is online and using a live stream slot."
          : "Bring the enrolled player online and confirm the live session.",
        owner: "Live evidence",
        complete: activePlayerStreams > 0,
        href: activePlayerStreams > 0 ? "/dashboard/player-sessions" : "/dashboard/players",
        actionLabel: activePlayerStreams > 0 ? "View live locations" : "Check player readiness"
      }
    ]
  });
}

export function buildSchoolProductOnboarding({
  serviceEnabled = true,
  membershipRole = "VIEWER",
  schoolProfileReady = false,
  activeSupervisorCount = 0,
  safeguardingStatus = null,
  activeProgrammeCount = 0,
  approvedEpisodeCount = 0,
  activePlayerStreams = 0
} = {}) {
  const canManage = MANAGER_ROLES.has(membershipRole);
  const safeguardingApproved = safeguardingStatus === "APPROVED";
  const safeguardingWaiting = safeguardingStatus === "READY_FOR_REVIEW";

  return finishProductOnboarding({
    product: "School Radio",
    serviceEnabled,
    completeAction: {
      href: "/dashboard/school-radio",
      label: "Open School Radio",
      title: "School Radio is ready",
      description: "The school has approved safeguarding, a supervised programme, approved audio and a live session."
    },
    steps: [
      {
        id: "SCHOOL_PROFILE",
        label: "Prepare the school workspace",
        detail: schoolProfileReady
          ? "The organisation has its private School Radio workspace."
          : "Open School Radio to create the school-owned workspace and policy boundary.",
        owner: canManage ? "Your task" : "Owner or manager",
        complete: schoolProfileReady,
        href: "/dashboard/school-radio",
        actionLabel: subscriberTask(canManage, "Open School Radio")
      },
      {
        id: "SUPERVISION",
        label: "Confirm staff supervision",
        detail: activeSupervisorCount > 0
          ? "An active staff supervisor is assigned."
          : "Assign an authorised staff supervisor before creating student-led programmes.",
        owner: canManage ? "Your task" : "Owner or manager",
        complete: activeSupervisorCount > 0,
        href: "/dashboard/school-radio",
        actionLabel: subscriberTask(canManage, "Set up supervision")
      },
      {
        id: "SAFEGUARDING",
        label: "Approve safeguarding readiness",
        detail: safeguardingApproved
          ? "The safeguarding policy pack is approved."
          : safeguardingWaiting
            ? "The completed safeguarding pack is waiting for Ruvanas review."
            : "Complete the policy, consent, privacy and moderation readiness pack.",
        owner: safeguardingWaiting ? "Ruvanas review" : canManage ? "Your task" : "Owner or manager",
        complete: safeguardingApproved,
        href: "/dashboard/school-radio",
        actionLabel: safeguardingWaiting ? "View review status" : subscriberTask(canManage, "Prepare safeguarding")
      },
      {
        id: "PROGRAMME",
        label: "Create a supervised programme",
        detail: activeProgrammeCount > 0
          ? "An active staff-supervised programme is available."
          : "Create the first programme and assign its staff supervisor.",
        owner: canManage ? "Your task" : "Owner or manager",
        complete: activeProgrammeCount > 0,
        href: "/dashboard/school-radio",
        actionLabel: subscriberTask(canManage, "Create programme")
      },
      {
        id: "APPROVED_EPISODE",
        label: "Approve the first episode",
        detail: approvedEpisodeCount > 0
          ? "At least one episode has completed staff review."
          : "Create an episode, submit its audio and complete staff moderation.",
        owner: canManage ? "Staff review" : "Owner or manager",
        complete: approvedEpisodeCount > 0,
        href: "/dashboard/school-radio",
        actionLabel: subscriberTask(canManage, "Review school content")
      },
      {
        id: "DELIVERY",
        label: "Confirm controlled playback",
        detail: activePlayerStreams > 0
          ? "An approved school player is online."
          : "Bring the approved listening device online and confirm a live session.",
        owner: "Live evidence",
        complete: activePlayerStreams > 0,
        href: activePlayerStreams > 0 ? "/dashboard/player-sessions" : "/dashboard/players",
        actionLabel: activePlayerStreams > 0 ? "View live sessions" : "Check school player"
      }
    ]
  });
}

export function buildOnlineRadioProductOnboarding({
  serviceEnabled = true,
  membershipRole = "VIEWER",
  firstStationId = null,
  stationActive = false,
  streamConfigured = false,
  activeMusicModeCount = 0,
  publishedScheduleCount = 0,
  activePlayerStreams = 0
} = {}) {
  const canManage = MANAGER_ROLES.has(membershipRole);
  const programmeReady = activeMusicModeCount > 0 && publishedScheduleCount > 0;
  const stationHref = firstStationId ? `/stations/${firstStationId}` : canManage ? "/stations/new" : "/dashboard/notifications";

  return finishProductOnboarding({
    product: "Online Radio",
    serviceEnabled,
    completeAction: {
      href: firstStationId ? `/stations/${firstStationId}` : "/dashboard/radio",
      label: "Open station control",
      title: "Online Radio is ready",
      description: "The station, stream connection, continuous programme and listening session are all available."
    },
    steps: [
      {
        id: "STATION",
        label: "Create the online station",
        detail: stationActive
          ? "An active station is available."
          : "Create the station identity and confirm its service limits.",
        owner: canManage ? "Your task" : "Owner or manager",
        complete: stationActive,
        href: stationHref,
        actionLabel: firstStationId ? "Open station" : subscriberTask(canManage, "Create station", "Check notifications")
      },
      {
        id: "STREAM",
        label: "Connect the broadcast stream",
        detail: streamConfigured
          ? "The station has a private streaming connection and public stream URL."
          : "Connect the approved streaming provider details to the station.",
        owner: canManage ? "Your task" : "Owner or manager",
        complete: streamConfigured,
        href: firstStationId ? `/stations/${firstStationId}/setup` : stationHref,
        actionLabel: subscriberTask(canManage, "Configure streaming")
      },
      {
        id: "PROGRAMMING",
        label: "Publish continuous programming",
        detail: programmeReady
          ? "An active music mode and published schedule are ready."
          : "Prepare approved audio and publish the station schedule.",
        owner: canManage ? "Your task" : "Owner or manager",
        complete: programmeReady,
        href: "/dashboard/programming",
        actionLabel: subscriberTask(canManage, "Open programming")
      },
      {
        id: "LISTENING",
        label: "Confirm a live listening session",
        detail: activePlayerStreams > 0
          ? "The service has a current listening session."
          : "Open the approved player and confirm the station is heard live.",
        owner: "Live evidence",
        complete: activePlayerStreams > 0,
        href: activePlayerStreams > 0 ? "/dashboard/player-sessions" : "/dashboard/players",
        actionLabel: activePlayerStreams > 0 ? "Monitor listeners" : "Check listening setup"
      }
    ]
  });
}
