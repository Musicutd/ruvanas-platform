// Public marketing visibility only. This does not grant or revoke product access.
// Add reviewed pillars here when each is ready for its public launch, then rebuild
// the frozen homepage with scripts/build-public-homepage.mjs --write.
export const PUBLIC_HOMEPAGE_PRODUCT_FAMILIES = Object.freeze(["RETAIL"]);

export function isHomepageProductVisible(productId) {
  return PUBLIC_HOMEPAGE_PRODUCT_FAMILIES.includes(productId);
}

const products = [
  ["RETAIL", "retail", "Retail"], ["SCHOOL", "school", "School"],
  ["ONLINE", "online", "Online"], ["HEALTH", "health", "Health"],
  ["FAITH", "faith", "Faith"], ["ORGANISATIONS", "organisations", "Organisations"],
  ["CORRECTIONS", "corrections", "Inside"]
];

// Input is the checked-in, complete seven-pillar source, never request data.
// Regeneration keeps unlaunched content out of the served HTML, rather than
// hiding it with CSS. The full source stays available for subsequent launches.
export function buildPublicHomepage(source, families = PUBLIC_HOMEPAGE_PRODUCT_FAMILIES) {
  if (typeof source !== "string" || !Array.isArray(families) || !families.length ||
      new Set(families).size !== families.length || families.some(id => !products.some(p => p[0] === id))) {
    throw new Error("Invalid public homepage launch selection");
  }
  const visible = new Set(families);
  let html = source;
  let platformCount = 0, pricingCount = 0, storyCount = 0;
  html = html.replace(/<article class="platformCard">[\s\S]*?<\/article>/g, block =>
    visible.has(products[platformCount++]?.[0]) ? block : "");
  html = html.replace(/<section class="pricingFamily" id="pricing-([a-z]+)">[\s\S]*?<\/section>/g, (block, id) => {
    pricingCount++;
    const product = products.find(p => p[1] === id);
    if (!product) throw new Error("Unknown homepage pricing family");
    return visible.has(product[0]) ? block : "";
  });
  html = html.replace(/<div class="storyProducts">[\s\S]*?<\/div>/, block =>
    block.replace(/<article><span>([^<]+)<\/span>[\s\S]*?<\/article>/g, (article, label) => {
      storyCount++;
      const product = products.find(p => p[2] === (label === "Radio" ? "Online" : label));
      if (!product) throw new Error("Unknown homepage story family");
      return visible.has(product[0]) ? article : "";
    }));
  if (platformCount !== 7 || pricingCount !== 7 || storyCount !== 6) throw new Error("Homepage source structure changed");
  html = html.replace(/<div class="floatingCard card(Retail|School|Online)">[\s\S]*?<\/div>/g,
    (block, label) => visible.has(products.find(p => p[2] === label)?.[0]) ? block : "");
  html = html.replace(/<section class="introStrip"[\s\S]*?<\/section>/,
    `<section class="introStrip" aria-label="Ruvanas introduction"><p>One professional foundation.</p><div>${products.filter(p => visible.has(p[0])).map(p => `<span>${p[2]}</span>`).join("<i></i>")}</div></section>`);
  if (families.length === 1 && visible.has("RETAIL")) {
    const copy = [
      ["Explore Ruvanas professional media platforms. Private preview access is by administrator-issued code.", "Music, AutoDJ, scheduling and shop announcements for Retail. Private preview access is by administrator-issued code."],
      ["Ruvanas | Professional Media Platforms", "Ruvanas | Retail Radio"],
      ['href="#platforms">Platforms', 'href="#platforms">Retail Radio'],
      ['href="/how-it-works/"', 'href="/how-it-works/#retail"'],
      ["Audio platforms by 21-Three", "Retail radio by 21-Three"],
      ["Every space deserves its <em>own sound.</em>", "Every shop deserves its <em>own sound.</em>"],
      ["Ruvanas brings professional media within reach—from retail and schools to online stations, health, faith and other organisations.", "Bring music, scheduled mixes and your own shop announcements together in one Retail radio workspace. One shared programme for all your shops."],
      ["Platform capabilities shown here are illustrative.", "Retail capabilities shown here are illustrative."],
      ["<strong>1–30+</strong><span>simultaneous streams</span>", "<strong>1</strong><span>shared programme for your shops</span>"],
      ["Seven platforms. One standard.", "One Retail workspace."],
      ["Built around the way you broadcast.", "Built around your shops."],
      ["Choose the platform that fits today, then bring every channel, location and audience together as your ambitions grow.", "Choose your music, plan the week and schedule your shop messages from one place."],
      ["Manage players, locations, schools, stations and simultaneous streams from one secure workspace.", "Manage your shops, listening areas and audio players from one secure workspace."],
      ["Start with one location or station, then add streams, schools, signage and campaigns as you expand.", "Start with one shop, then add locations and audio campaigns as your business grows."],
      ["Plans shaped around your platform", "Plans shaped around your shops"],
      ["Choose the service you need. Grow when you are ready.", "Choose your Retail plan. Grow when you are ready."],
      ["Seven specialised product families each have five clear tiers, shared foundations and purpose-built workflows.", "Five Retail tiers, each with a Focused Licensed Music Catalogue, subject to product-use and territory rights."],
      ["We can tailor streams, listeners, schools, storage, identity, governance, onboarding and support around your organisation.", "We can tailor Retail locations, storage, identity, onboarding and support around your business."],
      ["professional audio, broadcasting, content management and digital display technology", "professional audio, music scheduling and shop communication"],
      ["One platform. Six specialised worlds.", "One shared programme. Every shop."],
      ["Ruvanas has been designed around a shared technology core, but with dedicated experiences for very different types of organisations.", "Ruvanas Retail brings music and shop messages together, with one shared programme across your locations."],
      ["24/7 AutoDJ, intelligent scheduling, live broadcasting, Ruvanas Studio, podcasts, promotions, digital signage, device management, analytics, proof-of-play, multi-location control and rights-aware media management", "24/7 AutoDJ, intelligent scheduling, Ruvanas Studio, shop announcements, audio promotions, device management, analytics, proof-of-play, multi-location control and rights-aware music management"],
      ["By sharing these capabilities across one core platform, Ruvanas can give each sector its own specialised experience without forcing organisations to work with several disconnected systems.", "Ruvanas brings these Retail audio tools into one workspace, so shops can manage their music and messages together."],
      ["Professional media platforms for brands, schools, broadcasters, health, faith and other organisations.", "Professional Retail radio for music, shop messages and one shared programme across your locations."]
    ];
    for (const [before, after] of copy) {
      if (!html.includes(before)) throw new Error(`Homepage copy changed: ${before}`);
      html = html.replaceAll(before, after);
    }
    html = html.replace("<span>Retail</span></div></section>", "<span>Music</span><i></i><span>Scheduling</span><i></i><span>Shop announcements</span></div></section>");
  }
  return html.replace("</style>", ".platformGrid > :only-child { grid-column: 1 / -1; }\n</style>");
}
