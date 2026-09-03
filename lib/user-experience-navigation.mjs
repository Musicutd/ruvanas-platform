const subscriberSections = [
  {
    id: "radio",
    label: "Run your radio",
    description: "Set up stations, players and live devices using your plan.",
    items: [
      { id: "station", label: "Radio station", description: "Open your station and review its streaming setup." },
      { id: "players", href: "/dashboard/players", label: "Players & devices", description: "Prepare and check the secure players connected to your service." },
      { id: "sessions", href: "/dashboard/player-sessions", label: "Live streams", description: "See which players are currently using your stream allowance." }
    ]
  },
  {
    id: "content",
    label: "Create and schedule",
    description: "Manage audio, production work and the optional products on your account.",
    items: [
      { id: "media", href: "/dashboard/media", label: "Media library", description: "Upload and organise audio for your organisation." },
      { id: "studio", href: "/dashboard/studio", label: "Ruvanas Studio", description: "Request and follow professional audio production.", entitlement: "serviceEnabled" },
      { id: "school", href: "/dashboard/school-radio", label: "School Radio", description: "Open the supervised school broadcasting workspace.", entitlement: "schoolRadioEnabled" },
      { id: "retail", href: "/dashboard/retail-media", label: "Retail Media", description: "Coordinate approved commercial media campaigns.", entitlement: "retailMediaEnabled" },
      { id: "signage", href: "/dashboard/digital-signage", label: "Digital Signage", description: "Manage approved visual content and displays.", entitlement: "digitalSignageEnabled" }
    ]
  },
  {
    id: "insight",
    label: "Monitor and report",
    description: "Review important events and evidence without searching through setup screens.",
    items: [
      { id: "notifications", href: "/dashboard/notifications", label: "Notifications", description: "See operational items that may need attention." },
      { id: "analytics", href: "/dashboard/analytics", label: "Service insights", description: "Review evidence-led operational trends." },
      { id: "reports", href: "/dashboard/reports", label: "Delivery reports", description: "Review campaign and proof-of-play results." },
      { id: "help", href: "/dashboard/help", label: "Help centre", description: "Find setup steps and safe answers to common questions." },
      { id: "complimentary", href: "/dashboard/complimentary-access", label: "Complimentary access", description: "Activate or review a Ruvanas-issued free-access code." },
      { id: "support", href: "/dashboard/support", label: "Support requests", description: "Ask Ruvanas for help and follow the request status." }
    ]
  }
];

const adminSections = [
  {
    id: "radio",
    label: "Radio setup",
    description: "Locations, channels, schedules and players",
    items: [
      { href: "/admin/location-groups", label: "Location groups" },
      { href: "/admin/locations", label: "Retail locations" },
      { href: "/admin/channels", label: "Ruvanas Channels" },
      { href: "/admin/music-modes", label: "Music modes", superAdminOnly: true },
      { href: "/admin/music-schedules", label: "Music schedules", superAdminOnly: true },
      { href: "/admin/players", label: "Players & health" },
      { href: "/admin/stations", label: "Stations" }
    ]
  },
  {
    id: "content",
    label: "Content & campaigns",
    description: "Music, promotions, brands and delivery evidence",
    items: [
      { href: "/admin/catalogue", label: "Music Catalogue", superAdminOnly: true },
      { href: "/admin/media", label: "Promo Library" },
      { href: "/admin/brands", label: "Brands" },
      { href: "/admin/campaigns", label: "Campaigns", superAdminOnly: true },
      { href: "/admin/proof-of-play", label: "Proof of play" }
    ]
  },
  {
    id: "products",
    label: "Products & schools",
    description: "School safeguards and additional media products",
    items: [
      { href: "/admin/school-safeguarding", label: "School safeguarding", superAdminOnly: true },
      { href: "/admin/retail-media", label: "Retail media", superAdminOnly: true },
      { href: "/admin/digital-signage", label: "Digital signage", superAdminOnly: true },
      { href: "/admin/ai", label: "AI draft workspace", superAdminOnly: true }
    ]
  },
  {
    id: "business",
    label: "Customers & business",
    description: "Organisations, plans and governed support",
    items: [
      { href: "/admin/organisations", label: "Organisations" },
      { href: "/admin/complimentary-access", label: "Complimentary access", superAdminOnly: true },
      { href: "/admin/billing", label: "Billing & usage", superAdminOnly: true },
      { href: "/admin/compliance", label: "Compliance & support" }
    ]
  },
  {
    id: "operations",
    label: "Platform operations",
    description: "Security, integrations, reliability and launch controls",
    items: [
      { href: "/admin/security", label: "Identity & security", superAdminOnly: true },
      { href: "/admin/integrations", label: "API & integrations", superAdminOnly: true },
      { href: "/admin/jobs", label: "Jobs & notifications", superAdminOnly: true },
      { href: "/admin/operations", label: "Platform health", superAdminOnly: true },
      { href: "/admin/recovery", label: "Backup & recovery", superAdminOnly: true },
      { href: "/admin/launch-readiness", label: "Launch readiness", superAdminOnly: true }
    ]
  }
];

export function buildSubscriberNavigation({ entitlements = {}, firstStationId = null } = {}) {
  return subscriberSections.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => !item.entitlement || Boolean(entitlements[item.entitlement]))
      .map((item) => item.id === "station" ? {
        ...item,
        href: firstStationId ? `/stations/${firstStationId}` : "/stations/new",
        label: firstStationId ? "Radio station" : "Create your station",
        description: firstStationId
          ? item.description
          : "Start with the station that will carry your radio service."
      } : item)
  })).filter((section) => section.items.length > 0);
}

export function buildAdminNavigation(role) {
  return adminSections.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.superAdminOnly || role === "SUPER_ADMIN")
  })).filter((section) => section.items.length > 0);
}

export function resolveDashboardNextAction({
  serviceEnabled = true,
  stationCount = 0,
  configuredPlayerCount = 0,
  activePlayerStreams = 0
} = {}) {
  if (!serviceEnabled) {
    return {
      code: "SERVICE_ATTENTION",
      eyebrow: "SERVICE ATTENTION",
      title: "Review your service notifications",
      description: "Your radio tools are currently limited. Review the latest service message before continuing setup.",
      href: "/dashboard/notifications",
      label: "Review notifications"
    };
  }

  if (stationCount === 0) {
    return {
      code: "CREATE_STATION",
      eyebrow: "START HERE",
      title: "Create your first radio station",
      description: "This gives your organisation its first radio service and streaming configuration.",
      href: "/stations/new",
      label: "Create station"
    };
  }

  if (configuredPlayerCount === 0) {
    return {
      code: "SET_UP_PLAYER",
      eyebrow: "NEXT STEP",
      title: "Prepare your first player",
      description: "Create a secure player for the location or listening area where your audience will hear the radio.",
      href: "/dashboard/players",
      label: "Set up a player"
    };
  }

  if (activePlayerStreams === 0) {
    return {
      code: "BRING_PLAYER_ONLINE",
      eyebrow: "READY TO CONNECT",
      title: "Bring a player online",
      description: "Follow the guided player checklist and confirm that the listening location is receiving audio.",
      href: "/dashboard/players",
      label: "Check player readiness"
    };
  }

  return {
    code: "MONITOR_SERVICE",
    eyebrow: "RADIO LIVE",
    title: "Your radio is running",
    description: "Review the active stream or open your station when you want to make changes.",
    href: "/dashboard/player-sessions",
    label: "View live streams"
  };
}

