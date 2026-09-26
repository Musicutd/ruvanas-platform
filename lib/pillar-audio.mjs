export const AUDIO_PILLARS = Object.freeze({
  RETAIL: { label: "Retail Radio", dashboardHref: "/dashboard/retail", autoDjHref: "/dashboard/retail/music", rightsUse: "RETAIL_RADIO" },
  SCHOOL: { label: "School Radio", dashboardHref: "/dashboard/school", autoDjHref: "/dashboard/autodj/school", rightsUse: "SCHOOL_RADIO" },
  ONLINE: { label: "Online Radio", dashboardHref: "/dashboard/radio", autoDjHref: "/dashboard/autodj/online", rightsUse: "ONLINE_RADIO" },
  HEALTH: { label: "Ruvanas Health", dashboardHref: "/dashboard/health", autoDjHref: "/dashboard/autodj/health", rightsUse: "HEALTH_RADIO" },
  FAITH: { label: "Ruvanas Faith", dashboardHref: "/dashboard/faith", autoDjHref: "/dashboard/autodj/faith", rightsUse: "FAITH_RADIO" },
  ORGANISATIONS: { label: "Ruvanas Organisations", dashboardHref: "/dashboard/organisations", autoDjHref: "/dashboard/autodj/organisations", rightsUse: "ORGANISATIONS_RADIO" }
});

export function audioPillar(value) {
  return AUDIO_PILLARS[String(value || "").trim().toUpperCase()] || null;
}

export function pillarListenHref(product, stationId) {
  const key = String(product || "").trim().toUpperCase();
  if (!audioPillar(key)) return null;
  const base = `/dashboard/listen/${key.toLowerCase()}`;
  return stationId ? `${base}?stationId=${encodeURIComponent(stationId)}` : base;
}

export function secureListenerUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function firstListenablePillarStation(stations = [], product) {
  const key = String(product || "").trim().toUpperCase();
  const ready = stations.filter((station) => station.productFamily === key && secureListenerUrl(station.streamConfig?.streamUrl));
  return ready.find((station) => station.status === "ACTIVE") || ready[0] || null;
}

export function channelMatchesPillar(channel, product) {
  const key = String(product || "").trim().toUpperCase();
  const pillar = audioPillar(key);
  return Boolean(pillar && channel?.rightsUse === pillar.rightsUse && (channel?.productFamily === key || !channel?.productFamily));
}

export function dashboardAudioPillar(pathname) {
  const path = String(pathname || "").toLowerCase();
  const match = path.match(/^\/dashboard\/(?:autodj|listen)\/(retail|school|online|health|faith|organisations)(?:\/|$)/);
  if (match) return match[1].toUpperCase();
  if (path === "/dashboard/radio" || path.startsWith("/dashboard/radio/") || path === "/dashboard/stations" || path.startsWith("/dashboard/stations/")) return "ONLINE";
  if (path === "/dashboard/school" || path.startsWith("/dashboard/school/") || path === "/dashboard/school-radio" || path.startsWith("/dashboard/school-radio/")) return "SCHOOL";
  for (const product of ["RETAIL", "HEALTH", "FAITH", "ORGANISATIONS"]) {
    const prefix = `/dashboard/${product.toLowerCase()}`;
    if (path === prefix || path.startsWith(`${prefix}/`)) return product;
  }
  return null;
}
