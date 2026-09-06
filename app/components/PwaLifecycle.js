"use client";

import { useEffect, useState } from "react";
import styles from "./pwa-lifecycle.module.css";

export default function PwaLifecycle({ stationPath }) {
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [updateWorker, setUpdateWorker] = useState(null);
  const [iosHelp, setIosHelp] = useState(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    if (stationPath) window.localStorage.setItem("ruvanas_last_station_path", stationPath);
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    const installHandler = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    window.addEventListener("beforeinstallprompt", installHandler);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    setIosHelp(!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent));

    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) setUpdateWorker(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateWorker(worker);
          });
        });
      }).catch(() => {});
    }
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
      window.removeEventListener("beforeinstallprompt", installHandler);
    };
  }, [stationPath]);

  async function install() {
    await installPrompt?.prompt();
    await installPrompt?.userChoice;
    setInstallPrompt(null);
  }

  function update() {
    let reloaded = false;
    navigator.serviceWorker?.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; window.location.reload(); } }, { once: true });
    updateWorker?.postMessage({ type: "SKIP_WAITING" });
    setUpdateWorker(null);
    window.setTimeout(() => { if (!reloaded) window.location.reload(); }, 1_500);
  }

  if (online && !installPrompt && !updateWorker && !iosHelp) return null;
  return <aside className={styles.status} aria-live="polite">
    {!online ? <div><strong>You are offline</strong><span>The last opened station page remains available. Live audio resumes when the connection returns.</span></div> : null}
    {installPrompt ? <div><strong>Keep this station close</strong><span>Install it on this device for quicker access.</span><button type="button" onClick={install}>Install</button></div> : null}
    {iosHelp ? <div><strong>Add to iPhone or iPad</strong><span>Use Share, then choose “Add to Home Screen”.</span><button type="button" onClick={() => setIosHelp(false)}>Got it</button></div> : null}
    {updateWorker ? <div><strong>A station update is ready</strong><span>Refresh when convenient to use the latest version.</span><button type="button" onClick={update}>Update</button></div> : null}
  </aside>;
}
