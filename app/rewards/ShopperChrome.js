"use client";

import styles from "./shopper-discovery.module.css";

export function ShopperIcon({ name, ...props }) {
  const paths = {
    pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    down: <path d="m6 9 6 6 6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    explore: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2 6-6 2 2-6Z" /></>,
    voucher: <><path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4Z" /><path d="M9 5v2m0 3v2m0 3v2" /></>,
    account: <><circle cx="12" cy="7" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2Z" /></>,
    fashion: <path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4c-1 3-7 3-8 0Z" />,
    food: <><path d="M4 2v7c0 4 6 4 6 0V2M7 2v20M20 2v20M20 2c-5 3-5 11 0 11" /></>,
    home: <><path d="m2 11 10-9 10 9M5 9v13h14V9M10 22v-8h4v8" /></>,
    sparkle: <><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" /></>
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.voucher}</svg>;
}

export function ShopperHeader({ onHome }) {
  const brand = <><span>RUVANAS</span><strong>Rewards</strong></>;
  return <header className={styles.siteHeader}>{onHome ? <button type="button" className={styles.brand} onClick={onHome} aria-label="Ruvanas Rewards home">{brand}</button> : <a href="/rewards" className={styles.brand}>{brand}</a>}</header>;
}

export function ShopperNav({ active = "explore", onExplore, onWallet, onAccount, enableWallet = true }) {
  function item(name, text, href, action, enabled = true) {
    const content = <><ShopperIcon name={name === "wallet" ? "voucher" : name} /><span>{text}</span></>;
    const shared = { className: active === name ? styles.activeNav : "", "aria-current": active === name ? "page" : undefined };
    return action || !enabled ? <button type="button" {...shared} onClick={action} disabled={!enabled}>{content}</button>
      : <a {...shared} href={href}>{content}</a>;
  }
  return <nav className={styles.bottomNav} aria-label="Shopper navigation">
    {item("explore", "Explore", "/rewards", onExplore)}
    {item("wallet", "My vouchers", "/rewards/wallet", onWallet, enableWallet)}
    {item("account", "Account", "/rewards#account", onAccount)}
  </nav>;
}
