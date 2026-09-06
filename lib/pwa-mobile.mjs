const APP_ICON = "/icons/ruvanas-app.svg";

function shortName(value) {
  return Array.from(String(value || "Ruvanas")).slice(0, 24).join("");
}

export function publicOfflineCachePath(value) {
  let url;
  try { url = new URL(String(value || ""), "https://ruvanas.invalid"); }
  catch { return null; }
  return /^\/(radio|podcasts)\/[^/]+/.test(url.pathname) ? url.pathname : null;
}

export function buildStationWebManifest(website) {
  if (!website?.slug || !website?.name) throw new Error("A published station website is required.");
  const encodedSlug = encodeURIComponent(website.slug);
  const shortcuts = website.playerEnabled ? [{ name: "Listen live", short_name: "Listen", url: `/listen/${encodedSlug}`, icons: [{ src: APP_ICON, sizes: "any", type: "image/svg+xml" }] }] : [];
  if (website.podcasts?.[0]) shortcuts.push({ name: "Station podcasts", short_name: "Podcasts", url: website.podcasts[0].url, icons: [{ src: APP_ICON, sizes: "any", type: "image/svg+xml" }] });
  return {
    id: `/radio/${website.slug}`,
    name: `${website.name} — Ruvanas Radio`,
    short_name: shortName(website.name),
    description: website.tagline || website.description || `Listen live to ${website.name}.`,
    lang: "en",
    start_url: `/radio/${encodedSlug}?source=pwa`,
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: website.theme === "LIGHT" ? "#f4f1ea" : "#07101d",
    theme_color: website.accent || "#f4b942",
    categories: ["music", "entertainment"],
    icons: [
      { src: APP_ICON, sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: APP_ICON, sizes: "any", type: "image/svg+xml", purpose: "maskable" }
    ],
    shortcuts
  };
}
