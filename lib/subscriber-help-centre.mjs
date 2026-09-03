const MANAGER_ROLES = new Set(["OWNER", "MANAGER"]);

export const subscriberHelpArticles = Object.freeze([
  {
    id: "getting-started",
    category: "Getting started",
    title: "Start your first shop radio",
    summary: "Follow the evidence-based setup guide from station creation to verified live playback.",
    keywords: ["start", "setup", "onboarding", "first shop", "checklist"],
    steps: [
      "Create and connect the station that supplies the radio service.",
      "Wait for the Ruvanas-managed location, music mode and published schedule to be ready.",
      "Prepare and enrol one secure player for each subscribed shop or listening zone.",
      "Keep the player online until recent playback evidence marks the shop ready."
    ]
  },
  {
    id: "station-setup",
    category: "Radio setup",
    title: "Create and connect a station",
    summary: "Understand the station identity and the private streaming details needed before it becomes active.",
    keywords: ["station", "streaming", "host", "port", "mount", "password", "provider"],
    steps: [
      "Choose a clear station name and short description.",
      "Use the approved streaming-provider welcome details for the host, port, stream URL and bitrate.",
      "Enter private passwords only on the secure setup page; they are not displayed again.",
      "Return to the subscriber home and confirm that the station step is complete."
    ]
  },
  {
    id: "managed-programme",
    category: "Music and schedules",
    title: "How music and schedules become ready",
    summary: "Ruvanas-managed music modes and published schedules keep approved programming separate from subscriber uploads.",
    keywords: ["music", "schedule", "playlist", "mode", "catalogue", "autodj", "programme"],
    steps: [
      "Ruvanas operations prepares the listening location and its playback zone.",
      "Approved catalogue tracks are assembled into an active music mode.",
      "A weekly schedule is published for the location or zone.",
      "The setup guide updates automatically when both the music mode and schedule are ready."
    ]
  },
  {
    id: "shop-players",
    category: "Shop players",
    title: "Prepare and enrol a shop player",
    summary: "Use one securely enrolled device for each subscribed shop or listening zone.",
    keywords: ["player", "shop", "device", "enrol", "code", "replace", "quota"],
    steps: [
      "Choose the correct shop and listening zone, then create a clearly named player.",
      "Enter the one-time enrolment code only on the device that will remain at that shop.",
      "Allow audio when the browser requests it and keep the player page open.",
      "Use the replacement workflow instead of copying a player identity to another device."
    ]
  },
  {
    id: "audio-uploads",
    category: "Content",
    title: "Upload announcements, jingles and commercials",
    summary: "Submit organisation-owned audio for review without mixing it into the managed music catalogue.",
    keywords: ["upload", "audio", "jingle", "commercial", "announcement", "voiceover", "file"],
    steps: [
      "Choose the original audio file from the computer or device.",
      "Add a useful name, content type, language and duration when known.",
      "Upload the file securely and wait for its review status.",
      "Remember that upload completion does not automatically place the audio on air."
    ]
  },
  {
    id: "live-streams",
    category: "Playback",
    title: "Understand live playback and stream limits",
    summary: "See why a player is ready, how live slots are counted and what happens when a device disconnects.",
    keywords: ["live", "playback", "stream", "limit", "listener", "offline", "heartbeat", "evidence"],
    steps: [
      "A live slot belongs to an enrolled player while its secure session remains active.",
      "Readiness requires enrolment, channel assignment, recent device contact and playback evidence.",
      "A refreshed player returns to the shared channel clock instead of restarting the programme.",
      "If the allowance is full, stop or replace the correct player rather than sharing its link."
    ]
  },
  {
    id: "roles-and-access",
    category: "Account access",
    title: "What owners, managers and viewers can do",
    summary: "Use the correct account role without treating visible navigation as permission.",
    keywords: ["owner", "manager", "viewer", "role", "permission", "access"],
    steps: [
      "Owners and managers can complete controlled subscriber setup actions.",
      "Viewers can review service state but cannot create, replace or stop shop players.",
      "Ruvanas-managed catalogue and schedule controls remain inside authorised administration.",
      "Every protected action is checked again by the server, regardless of the visible page."
    ]
  },
  {
    id: "account-and-plan",
    category: "Account access",
    title: "Understand your plan and allowances",
    summary: "Review service access, included products, stream capacity and safe owner-only account records.",
    keywords: ["account", "plan", "tier", "allowance", "billing", "invoice", "storage", "price"],
    steps: [
      "Open Account & plan to confirm the current service status and plan arrangement.",
      "Compare configured stations, players, live streams and storage with the visible allowances.",
      "Check which Ruvanas products are included before planning new services.",
      "Ask the organisation owner to review financial records or contact Ruvanas for a plan change."
    ]
  },
  {
    id: "troubleshooting",
    category: "Troubleshooting",
    title: "When a setup step will not complete",
    summary: "Work through the safest checks before replacing a device or changing live configuration.",
    keywords: ["problem", "error", "stuck", "not ready", "offline", "help", "troubleshoot"],
    steps: [
      "Read the current step description and any notification before changing configuration.",
      "Refresh player readiness after the shop device has been online for at least 15 seconds.",
      "Confirm that the correct organisation is selected when you manage more than one account.",
      "Ask Ruvanas operations for help when a managed location, programme or provider detail is missing."
    ]
  }
]);

function normalizeQuery(query) {
  return String(query || "").trim().replace(/\s+/g, " ").slice(0, 80).toLowerCase();
}

export function searchSubscriberHelp(query, articles = subscriberHelpArticles) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [...articles];
  const terms = normalized.split(" ").filter(Boolean);
  return articles.filter((article) => {
    const haystack = [article.category, article.title, article.summary, ...article.keywords, ...article.steps]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function subscriberHelpOverview(membershipRole = "VIEWER") {
  const canManage = MANAGER_ROLES.has(membershipRole);
  return {
    canManage,
    roleLabel: String(membershipRole || "VIEWER").replaceAll("_", " ").toLowerCase(),
    guidance: canManage
      ? "You can follow the setup actions marked for an owner or manager. Ruvanas-managed steps update when controlled preparation is complete."
      : "You have view-only access. Use this centre to understand service status, then ask an owner or manager to make controlled changes.",
    articles: subscriberHelpArticles.map((article) => ({ ...article }))
  };
}

export function subscriberHelpHref(articleId) {
  return subscriberHelpArticles.some((article) => article.id === articleId)
    ? `/dashboard/help#${articleId}`
    : "/dashboard/help";
}
