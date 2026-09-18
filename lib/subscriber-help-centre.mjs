import { enabledSubscriberProducts } from "./product-access.mjs";

const MANAGER_ROLES = new Set(["OWNER", "MANAGER"]);

const PRODUCT_LABELS = Object.freeze({
  RETAIL: "Retail Radio", SCHOOL: "School Radio", ONLINE: "Online Radio",
  HEALTH: "Ruvanas Health", FAITH: "Ruvanas Faith", ORGANISATIONS: "Ruvanas Organisations"
});

// The primary plan determines the help journey even when an organisation has extra product overrides.
const ARTICLE_PRODUCTS = Object.freeze({
  "getting-started": ["RETAIL"],
  "locations-zones": ["RETAIL", "SCHOOL", "HEALTH", "FAITH", "ORGANISATIONS"],
  "station-setup": ["ONLINE"],
  "managed-programme": ["RETAIL"],
  "shop-players": ["RETAIL", "SCHOOL", "HEALTH", "FAITH", "ORGANISATIONS"],
  "live-streams": ["RETAIL", "SCHOOL", "HEALTH", "FAITH", "ORGANISATIONS"]
});

export const subscriberHelpArticles = Object.freeze([
  {
    id: "getting-started",
    category: "Getting started",
    title: "Start your first shop radio",
    summary: "Follow the evidence-based setup guide from station creation to verified live playback.",
    keywords: ["start", "setup", "onboarding", "first shop", "checklist"],
    steps: [
      "Create and connect the station that supplies the radio service.",
      "Create the shop location and its first playback area in Locations & Zones.",
      "Prepare and enrol one secure player for each subscribed shop or listening zone.",
      "Keep the player online until recent playback evidence marks the shop ready."
    ]
  },
  {
    id: "locations-zones",
    category: "Locations & Zones",
    title: "Create a site and playback area",
    summary: "Set up physical sites before preparing players and included displays.",
    keywords: ["location", "zone", "area", "shop", "school", "display", "signage"],
    steps: [
      "Open Locations & Zones from Audio & playout.",
      "Add the physical site name, its real timezone and the first area used by a player or included display.",
      "Add another area when one location has separate playback or display spaces.",
      "Return to Players & Devices or Digital Signage; the new area is immediately available there."
    ]
  },
  {
    id: "station-setup",
    category: "Radio setup",
    title: "Create and connect a station",
    summary: "Create the station identity; Ruvanas Super Admin manages its private stream connection.",
    keywords: ["station", "streaming", "host", "port", "mount", "password", "provider"],
    steps: [
      "Choose a clear station name and short description.",
      "Prepare approved audio and the station's Continuous AutoDJ rotation while setup is pending.",
      "Ruvanas Super Admin enters provider credentials, checks the source and activates the station.",
      "Open the public player and listen to verify the source after activation."
    ]
  },
  {
    id: "managed-programme",
    category: "Music and schedules",
    title: "How music and schedules become ready",
    summary: "Ruvanas-managed music modes and published schedules keep approved programming separate from subscriber uploads.",
    keywords: ["music", "schedule", "playlist", "mode", "catalogue", "autodj", "programme"],
    steps: [
      "An organisation owner or manager creates the listening location and playback area.",
      "Approved catalogue tracks are assembled into an active music mode.",
      "A weekly schedule is published for the location or zone.",
      "The setup guide updates automatically when both the music mode and schedule are ready."
    ]
  },
  {
    id: "shop-players",
    category: "Area players",
    title: "Prepare and enrol an area player",
    summary: "Use a securely enrolled device for each intended site or listening zone.",
    keywords: ["player", "shop", "device", "enrol", "code", "replace", "quota"],
    steps: [
      "Choose the correct site and listening zone, then create a clearly named player.",
      "Enter the one-time enrolment code only on the device assigned to that area.",
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
      "Viewers can review service state but cannot change protected setup or publishing settings.",
      "Ruvanas-managed catalogue and schedule controls remain inside authorised administration.",
      "Every protected action is checked again by the server, regardless of the visible page."
    ]
  },
  {
    id: "profile-security",
    category: "Account access",
    title: "Protect your personal account",
    summary: "Update your display name, change a password safely and sign out sessions you no longer recognise.",
    keywords: ["profile", "security", "password", "session", "sign out", "device", "identity"],
    steps: [
      "Open Profile & security to review your name, sign-in email and active sessions.",
      "Change your password only from a trusted device; other sessions are signed out automatically.",
      "If you cannot sign in, use Forgot your password on the sign-in page; its private link expires after 30 minutes and works once.",
      "Sign out any unfamiliar session without revealing private tokens or provider details.",
      "Contact Ruvanas support if your sign-in email or company-managed identity needs to change."
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
      "Compare the service usage and storage with the allowances shown for your plan.",
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
      "Check the product dashboard for the exact station, channel, location or device that needs attention.",
      "Confirm that the correct organisation is selected when you manage more than one account.",
      "Ask Ruvanas operations for help when a programme or provider detail is missing."
    ]
  }
]);

const PRODUCT_ARTICLES = Object.freeze({
  SCHOOL: [
    {
      id: "getting-started", category: "Getting started", title: "Start your school radio safely",
      summary: "Set safeguarding and staff responsibility before student production or public publishing.",
      keywords: ["school", "safeguarding", "student", "consent", "setup"],
      steps: [
        "Open School Radio and complete the safeguarding readiness pack with the responsible staff contact.",
        "Set up the school location and listening zones only where physical playback is needed.",
        "Assign staff supervision before inviting students or preparing programmes.",
        "Use the separate approval path before any public student content is released."
      ]
    }
  ],
  ONLINE: [
    {
      id: "getting-started", category: "Getting started", title: "Start your online station",
      summary: "Create a station, choose approved continuous music and connect the live source.",
      keywords: ["online", "station", "stream", "autodj", "setup"],
      steps: [
        "Create your Online Radio station and review its plan limits.",
        "Prepare rights-approved tracks and an active music mode for online radio use.",
        "Open Programming → Schedule, select the station channel and enable Continuous AutoDJ with that mode.",
        "Ruvanas Super Admin prepares the channel and streaming source; confirm the external stream receives Ruvanas audio before activation."
      ]
    },
    {
      id: "online-programming", category: "Station programming", title: "Keep your station playing with AutoDJ",
      summary: "A station channel uses its own programme schedule and continuous rotation.",
      keywords: ["autodj", "mode", "schedule", "channel", "rotation"],
      steps: [
        "In Programming, choose your Online Radio channel under Continuous AutoDJ.",
        "Select an active, rights-approved music mode and 24/7 playback when the station should run continuously.",
        "Save the rotation; this schedules content but does not by itself connect an encoder to the stream.",
        "Use the station-channel schedule for timed programmes."
      ]
    },
    {
      id: "online-listeners", category: "Broadcast monitoring", title: "Check live audio and listeners",
      summary: "Verify the source, public player and listener activity for your station.",
      keywords: ["stream", "live", "listener", "public player", "source"],
      steps: [
        "Open your station and its public player to confirm the actual audio being delivered.",
        "Check Live streams and Listener analytics for active sessions and trends.",
        "If the source is silent, ask Ruvanas to review the encoder lease and stream-source health.",
        "Do not enter provider passwords into public pages or share private stream settings."
      ]
    },
    {
      id: "online-advertising", category: "Station growth", title: "Review radio advertising",
      summary: "Commercial inventory appears only when the current plan enables it.",
      keywords: ["advertising", "campaign", "commercial", "sponsor"],
      capability: "retailMediaEnabled",
      steps: [
        "Open Radio advertising to review placement and break limits.",
        "Use approved campaigns with the correct station and rights scope.",
        "Check completed-play evidence before reporting delivery."
      ]
    }
  ],
  HEALTH: [
    {
      id: "getting-started", category: "Getting started", title: "Start health audio safely",
      summary: "Prepare an approved health channel, site and announcements without exposing patient information.",
      keywords: ["health", "hospital", "site", "privacy", "announcement"],
      steps: [
        "Open Ruvanas Health and confirm the permitted service and site allowances.",
        "Prepare the health site and channel for the intended listening area.",
        "Use approved announcements and rights-cleared audio; keep patient data out of public content.",
        "Verify playback and review service evidence before wider use."
      ]
    }
  ],
  FAITH: [
    {
      id: "getting-started", category: "Getting started", title: "Start your faith channel",
      summary: "Prepare continuous audio, teachings and services for the congregation you serve.",
      keywords: ["faith", "service", "sermon", "channel", "setup"],
      steps: [
        "Open Ruvanas Faith and confirm the channels and features in your tier.",
        "Prepare your own licensed music and teaching audio for the faith channel.",
        "Set continuous programming and schedule a service only when the content is approved.",
        "Test the listening page before sharing it with your audience."
      ]
    }
  ],
  ORGANISATIONS: [
    {
      id: "getting-started", category: "Getting started", title: "Start your organisation channel",
      summary: "Create subscriber-operated communications, announcements and events within your plan.",
      keywords: ["organisation", "channel", "announcement", "event", "setup"],
      steps: [
        "Open Ruvanas Organisations and review the channel and storage allowances.",
        "Prepare an organisation-owned channel and approved content for the intended audience.",
        "Plan announcements or an event with the correct dates and permissions.",
        "Preview playback and publish only after checking rights and audience access."
      ]
    }
  ]
});

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

export function subscriberHelpOverview(membershipRole = "VIEWER", entitlements = {}) {
  const canManage = MANAGER_ROLES.has(membershipRole);
  const enabled = enabledSubscriberProducts(entitlements).map((product) => product.key);
  const primary = enabled.includes(entitlements.planProductFamily)
    ? entitlements.planProductFamily
    : enabled[0] || null;
  const productArticles = PRODUCT_ARTICLES[primary] || [];
  const articles = subscriberHelpArticles
    .filter((article) => !ARTICLE_PRODUCTS[article.id] || ARTICLE_PRODUCTS[article.id].includes(primary))
    .filter((article) => article.id !== "getting-started" || primary === "RETAIL");
  articles.unshift(...productArticles);
  const visibleArticles = articles.filter((article) => !article.capability || entitlements[article.capability]);
  return {
    canManage,
    productLabel: PRODUCT_LABELS[primary] || "your Ruvanas service",
    planLabel: entitlements.planName || null,
    roleLabel: String(membershipRole || "VIEWER").replaceAll("_", " ").toLowerCase(),
    guidance: canManage
      ? "You can follow the setup actions marked for an owner or manager. Ruvanas-managed steps update when controlled preparation is complete."
      : "You have view-only access. Use this centre to understand service status, then ask an owner or manager to make controlled changes.",
    articles: visibleArticles.map((article) => ({ ...article }))
  };
}

export function subscriberHelpHref(articleId) {
  return [...subscriberHelpArticles, ...Object.values(PRODUCT_ARTICLES).flat()].some((article) => article.id === articleId)
    ? `/dashboard/help#${articleId}`
    : "/dashboard/help";
}
