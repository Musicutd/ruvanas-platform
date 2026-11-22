"use client";

import { useEffect, useRef } from "react";
import ShopBrand from "./ShopBrand";
import { buildShopDirectory, browseShops, vouchersForShop, shopBrowseLocations, shopBrowseCategories } from "@/lib/retail-rewards/vivid-shop-browse.mjs";
import baseStyles from "./shopper-vivid-dashboard.module.css";
import browseStyles from "./shop-browse.module.css";
const styles = { ...baseStyles, ...browseStyles };

const descriptions = { Dining: "A table worth finding", Tech: "Your next smart upgrade", Fashion: "Everyday favourites", Coffee: "Your next little pause", Entertainment: "Make a day of it", Wellness: "Time for yourself" };
const places = { Sliema: "Seaside finds & everyday favourites", Valletta: "Good discoveries around every corner", "St Julian’s": "A little time for yourself" };
function Mark({ name, ...props }) {
  const shapes = {
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    next: <path d="m9 5 7 7-7 7" />,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    Dining: <><path d="M4 3v6c0 4 6 4 6 0V3M7 3v19M20 3v19M20 3c-5 3-5 10 0 10" /></>,
    Tech: <><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M8 21h8m-4-5v5" /></>,
    Fashion: <><path d="M5 8h14l1 13H4L5 8Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
    Coffee: <><path d="M4 8h13v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8ZM17 9h2a3 3 0 0 1 0 6h-2M7 2v3m4-3v3m4-3v3" /></>,
    Entertainment: <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="m3 8 17-5-1-3L2 5l1 3Zm4-4 3 3m3-5 3 3M8 13h8" /></>,
    Wellness: <><path d="M20 4c-3-3-7-1-8 1-1-2-5-4-8-1-5 5 3 12 8 16 5-4 13-11 8-16Z" /><path d="M5 10h4l2-3 2 7 2-4h4" /></>
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{shapes[name] || shapes.pin}</svg>;
}
function LocationArt({ name, index }) {
  return <svg className={styles.locationArt} viewBox="0 0 320 150" fill="none" role="img" aria-label={`${name} illustration`}>
    <circle cx={235 - index * 26} cy="42" r="23" fill="currentColor" opacity=".16" />
    <path d="M0 119h320M0 136c28-8 50 8 78 0s50 8 78 0 50 8 78 0 58 8 86 0" stroke="currentColor" strokeWidth="1.2" opacity=".3" />
    {name === "Valletta" ? <><path d="M26 119V69h35v50m0 0V57h24v62m0 0V80h27v39m0 0V53h38v66m0 0V76h22v43m0 0V61h31v58m0 0V87h34v32m0 0V73h33v46m0 0V90h30v29" stroke="currentColor" strokeWidth="2" opacity=".7" /><path d="M121 53V43h20v10m-29-10c0-27 38-27 38 0h-38Zm20-22v-8m-3 3h6" stroke="currentColor" strokeWidth="2" /><path d="M32 80h5m11 0h5m-21 13h5m11 0h5m20-24h5m44-5h7m8 0h7m41 11h5m11 0h5m-16 13h5m11 0h5m49-3h6m12 0h6" stroke="currentColor" strokeWidth="3" /></> : <><path d="M22 119V79h27v40m0 0V53h37v66m0 0V68h32v51m0 0V84h24v35m0 0V41h31v78m0 0V64h33v55m0 0V88h28v31m0 0V72h36v47" stroke="currentColor" strokeWidth="2" opacity=".7" /><path d="M55 62h24m-24 12h24m-24 12h24m-24 12h24m49-4h8m15-41h18m-18 12h18m-18 12h18m-18 12h18m19-13h19m-19 14h19m35-7h22m-22 14h22" stroke="currentColor" strokeWidth="2" opacity=".55" /><path d="M280 119V74m-14 11c5-12 18-14 28-6m-15-4c-1-10 7-17 14-17m-13 17c-8-11-16-12-24-9" stroke="currentColor" strokeWidth="2" /></>}
  </svg>;
}

export const initialShopBrowse = () => ({ step: "locations", location: "", category: null, shopKey: null, shopSearch: "", voucherSearch: "" });
export default function ShopBrowsePane({ cards, renderCard, state, onState, previewOnly = false }) {
  const { step, location, category, shopKey, shopSearch, voucherSearch } = state;
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); }, [step, shopKey]);
  const directory = buildShopDirectory(cards), locations = shopBrowseLocations(directory), categories = shopBrowseCategories(directory, location);
  const shops = browseShops(directory, { location, category, search: shopSearch });
  const selected = directory.find(row => row.key === shopKey);
  const vouchers = vouchersForShop(cards, shopKey);
  const matching = vouchers.filter(card => !voucherSearch.trim() || [card.benefit, card.subtitle, card.category].join(" ").toLowerCase().includes(voucherSearch.trim().toLowerCase()));
  const update = changes => onState(current => ({ ...current, ...changes }));
  const showLocations = () => onState(initialShopBrowse());
  const chooseLocation = value => onState({ ...initialShopBrowse(), location: value, step: "categories" });
  const showCategories = () => update({ step: "categories", shopKey: null, voucherSearch: "" });
  const chooseCategory = value => update({ category: value, step: "shops", shopKey: null, shopSearch: "", voucherSearch: "" });
  const showShops = () => update({ step: "shops", shopKey: null, voucherSearch: "" });
  const openShop = key => update({ step: "shop", shopKey: key, voucherSearch: "" });
  const titles = { locations: ["FIND SOMETHING NEAR YOU", "Where are you shopping?", "Choose a location. Your next little win is closer than you think."], categories: [location.toUpperCase(), "What are you looking for?", "Choose a category to discover the shops around you."], shops: [category === "All" ? "ALL CATEGORIES" : category, `Shops in ${location}`, "Find a familiar favourite, or discover somewhere new."], shop: [selected?.categories.join(" · ").toUpperCase(), selected?.name || "Shop unavailable", selected?.subtitle || "This shop is not available right now."] };
  const hero = titles[step] || titles.locations;
  function searchField(label, value, key, count) { return <div className={styles.search}><Mark name="search" /><label className={styles.sr} htmlFor="vivid-search">{label}</label><input id="vivid-search" type="search" value={value} onChange={event => update({ [key]: event.target.value })} placeholder={`${label}…`} maxLength={100} autoComplete="off" /><span>{count} {count === 1 ? "result" : "results"}</span></div>; }
  return <>
    <nav className={styles.breadcrumb} aria-label="Browse steps"><button type="button" onClick={showLocations} aria-current={step === "locations" ? "step" : undefined}>Locations</button><Mark name="next" width="13" height="13" /><button type="button" onClick={showCategories} disabled={!location} aria-current={step === "categories" ? "step" : undefined}>Categories</button><Mark name="next" width="13" height="13" /><button type="button" onClick={showShops} disabled={!category} aria-current={step === "shops" ? "step" : undefined}>Shops</button><Mark name="next" width="13" height="13" /><span aria-current={step === "shop" ? "step" : undefined}>Vouchers</span></nav>
    <section className={styles.hero}><div><p className={styles.eyebrow}>{hero[0]}</p><h1 tabIndex={-1} ref={heading}>{hero[1]}</h1><p>{hero[2]}</p></div>{step === "shop" && <span className={styles.flipHint}>Tap a card to flip</span>}</section>
    {step === "locations" && <section className={styles.placesGrid} aria-label="Choose a location">{locations.map((name, index) => {
      const count = directory.filter(row => row.location === name).length;
      return <button type="button" key={name} className={styles.placeCard} data-place={index % 3} aria-label={`Choose ${name}`} onClick={() => chooseLocation(name)}><LocationArt name={name} index={index} /><span className={styles.placeCopy}><strong>{name}</strong><small>{places[name] || "Discover the shops around you"}</small><span className={styles.placeCount}>{count} {count === 1 ? "shop" : "shops"}<Mark name="next" width="15" height="15" /></span></span></button>;
    })}</section>}
    {step === "categories" && <><div className={styles.selectionNote}><Mark name="pin" width="16" height="16" />{location}<button type="button" onClick={showLocations}>Change location</button></div><section className={styles.browseCategoryGrid} aria-label="Choose a category">{categories.map(name => {
      const count = browseShops(directory, { location, category: name }).length;
      return <button type="button" className={styles.browseCategory} data-category={name} key={name} aria-label={`Choose ${name}`} onClick={() => chooseCategory(name)}><span className={styles.categoryEmblem}><Mark name={name} width="28" height="28" /></span><span><strong>{name}</strong><small>{descriptions[name] || "Find something for you"}</small></span><span className={styles.categoryCount}>{count} {count === 1 ? "shop" : "shops"}</span></button>;
    })}</section><button type="button" className={styles.allShops} onClick={() => chooseCategory("All")}>All categories<span>See every shop in {location}</span></button></>}
    {step === "shops" && <><div className={styles.selectionNote}><Mark name="pin" width="16" height="16" />{location}<span className={styles.selectionSeparator}>/</span>{category === "All" ? "All categories" : category}<button type="button" onClick={showCategories}>Change category</button></div>{searchField("Search shops", shopSearch, "shopSearch", shops.length)}<section className={styles.shopsGrid} aria-label="Matching shops">{shops.map(shop => <button type="button" key={shop.key} className={styles.shopTile} onClick={() => openShop(shop.key)} aria-label={`Open ${shop.name}`} data-shop-key={shop.key}><ShopBrand previewOnly={previewOnly} shop={shop} variant="tile" /><span className={styles.shopTileCopy}><span className={styles.shopTileCategory}>{shop.categories.join(" · ")}</span><strong>{shop.name}</strong><span className={styles.shopTileSubtitle}>{shop.subtitle}</span><span className={styles.shopTileBottom}><span><Mark name="pin" width="13" height="13" />{shop.location}</span><span>{shop.voucherCount} {shop.voucherCount === 1 ? "voucher" : "vouchers"}<Mark name="next" width="15" height="15" /></span></span></span></button>)}</section>{shops.length === 0 && <section className={styles.empty}><Mark name="search" width="32" height="32" /><h2>No shops found.</h2><p>Try another shop name or category.</p><button type="button" onClick={() => update({ shopSearch: "" })}>Clear search</button><button type="button" onClick={showCategories}>Choose another category</button></section>}</>}
    {step === "shop" && selected && <><section className={styles.shopProfile} aria-label={`${selected.name} shop profile`}><ShopBrand previewOnly={previewOnly} shop={selected} variant="hero" /><div className={styles.shopProfileCopy}><span className={styles.profileLocation}><Mark name="pin" width="16" height="16" />{selected.location}, Malta</span><h2>A little more at {selected.name}.</h2><p>{selected.subtitle}</p><div className={styles.profileCategories}>{selected.categories.map(name => <span key={name}>{name}</span>)}</div><span className={styles.profileCount}>{selected.voucherCount} {selected.voucherCount === 1 ? "voucher to discover" : "vouchers to discover"}</span></div></section><div className={styles.voucherSectionHeading}><h2>Available vouchers</h2><span>Flip a card for its code and terms.</span></div>{vouchers.length > 2 && searchField("Search vouchers", voucherSearch, "voucherSearch", matching.length)}<section className={styles.grid} aria-label={`${selected.name} vouchers`}>{matching.map(renderCard)}</section>{matching.length === 0 && <p className={styles.walletNote}>No vouchers match this search.</p>}<button type="button" className={styles.backToShops} onClick={showShops}><Mark name="next" width="16" height="16" style={{ transform: "rotate(180deg)" }} />Back to shops in {location}</button></>}
  </>;
}
