export function secureRadioListenerUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function firstListenableOnlineStation(stations = []) {
  const ready = stations.filter((station) => station.productFamily === "ONLINE" && secureRadioListenerUrl(station.streamConfig?.streamUrl));
  return ready.find((station) => station.status === "ACTIVE") || ready[0] || null;
}

export function onlineRadioListenHref(stationId) {
  return stationId ? `/dashboard/radio/listen?stationId=${encodeURIComponent(stationId)}` : null;
}
