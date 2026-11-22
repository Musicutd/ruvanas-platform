import styles from "./shop-brand.module.css";

// These marks belong only to the fictional preview shops. No remote asset,
// merchant upload or third-party logo is requested by this component.
const brands = {
  "demo-fuego-kitchen": { key: "fuego", wordmark: "FUEGO", descriptor: "WOOD-FIRED KITCHEN" },
  "demo-volt-store": { key: "volt", wordmark: "volt", descriptor: "TECH FOR EVERY DAY" },
  "demo-kova-apparel": { key: "kova", wordmark: "KOVA", descriptor: "APPAREL & EVERYDAY STYLE" },
  "demo-roast-and-co": { key: "roast", wordmark: "Roast & Co.", descriptor: "COFFEE · SLOW MOMENTS" },
  "demo-nova-cinema": { key: "nova", wordmark: "NOVA", descriptor: "CINEMA & BIG NIGHTS" },
  "demo-pulse-club": { key: "pulse", wordmark: "PULSE", descriptor: "REST. RECOVER. RENEW." }
};

function Emblem({ brand }) {
  if (brand === "fuego") return <g fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M36 3c3 16 24 20 24 39a24 24 0 0 1-48 0c0-11 5-20 13-25-1 11 4 14 7 16 5-9 7-19 4-30Z" /><path d="M37 33c0 10 12 14 12 23a13 13 0 0 1-26 0c0-7 5-11 7-14 1 6 4 8 7 9" /></g>;
  if (brand === "volt") return <g fill="currentColor"><path d="m39 2-27 39h22l-4 29 30-43H39l6-25Z" /><circle cx="7" cy="17" r="2" /><circle cx="65" cy="57" r="2" /></g>;
  if (brand === "kova") return <g fill="none" stroke="currentColor" strokeWidth="2"><rect x="10" y="8" width="52" height="56" rx="1" /><path d="M26 19v34m0-16 23-18M26 37l23 16" strokeWidth="3" /><path d="M18 1h36m-36 70h36" strokeWidth="1" /></g>;
  if (brand === "roast") return <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="36" cy="36" r="32" strokeWidth="1" opacity=".6" /><path d="M20 29h29v16a12 12 0 0 1-12 12h-5a12 12 0 0 1-12-12V29Zm29 3h6a7 7 0 0 1 0 14h-6M17 61h36M28 13c-5 5 5 5 0 10m10-10c-5 5 5 5 0 10" /></g>;
  if (brand === "nova") return <g fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round"><path d="m36 3 8 22 24 1-19 15 6 24-19-14-19 14 6-24L4 26l24-1Z" /><path d="m32 27 15 9-15 9V27Z" fill="currentColor" stroke="none" /><path d="M3 6h10M8 1v10m51 47h10m-5-5v10" strokeWidth="1.2" /></g>;
  if (brand === "pulse") return <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><circle cx="36" cy="36" r="33" strokeWidth="1" opacity=".4" /><circle cx="36" cy="36" r="26" strokeWidth="1" opacity=".65" /><path d="M12 37h13l7-15 8 29 6-14h14" strokeWidth="3" /></g>;
  return <g fill="none" stroke="currentColor" strokeWidth="2"><rect x="10" y="12" width="52" height="48" rx="8" /><path d="M24 27h24M24 37h24M24 47h14" /></g>;
}

export default function ShopBrand({ shop, variant = "tile", previewOnly = false }) {
  const name = shop?.name || shop?.shopName || "Local shop";
  const brand = previewOnly ? brands[shop?.slug || shop?.shopSlug] : null;
  const key = brand?.key || "fallback";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
  const badge = variant === "badge";
  const sizeClass = variant === "hero" ? styles.hero : badge ? styles.badge : styles.tile;
  return <div className={`${styles.brand} ${styles[key]} ${sizeClass}`} data-shop-brand={key}>
    <svg className={styles.artwork} viewBox={badge ? "0 0 100 100" : "0 0 400 230"} role="img" aria-label={`${name} ${brand ? "logo" : "initials"}`}>
      <title>{name} {brand ? "logo" : "initials"}</title>
      {!badge && <g className={styles.pattern} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
        {key === "volt" ? <><path d="M-30 190 150-20m-95 270L250-20m-20 270L425 0" /><path d="M0 45h400M0 185h400" /></>
          : key === "kova" ? <><rect x="18" y="16" width="364" height="198" /><rect x="24" y="22" width="352" height="186" /></>
          : key === "nova" ? <><circle cx="20" cy="31" r="2" /><circle cx="340" cy="39" r="2" /><circle cx="367" cy="173" r="1.8" /><circle cx="65" cy="183" r="1.8" /><path d="m45 75 20-7m275 89 20-7" /></>
          : key === "pulse" ? <><circle cx="0" cy="230" r="135" /><circle cx="0" cy="230" r="160" /><circle cx="400" cy="0" r="135" /><circle cx="400" cy="0" r="160" /></>
          : <><path d="M-25 198c70-90 105-72 146-16M282 49c64-82 135-64 157-10" /><circle cx="364" cy="188" r="48" /></>}
      </g>}
      <g transform={badge ? "translate(14 14)" : "translate(164 29)"} aria-hidden="true"><Emblem brand={key} /></g>
      {!badge && <>
        <text className={styles.wordmark} x="200" y="155" textAnchor="middle" fill="currentColor" aria-hidden="true">{brand?.wordmark || initials}</text>
        <text className={styles.descriptor} x="200" y="181" textAnchor="middle" fill="currentColor" aria-hidden="true">{brand?.descriptor || name.slice(0, 38)}</text>
      </>}
    </svg>
  </div>;
}
