"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function waitForMetadata(audio) {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Audio metadata timed out.")), 8000);
    const finish = (callback) => {
      window.clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", ready);
      audio.removeEventListener("error", failed);
      callback();
    };
    const ready = () => finish(resolve);
    const failed = () => finish(() => reject(new Error("Audio could not be loaded.")));
    audio.addEventListener("loadedmetadata", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
  });
}

function clampVolume(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

async function prepareItem(audio, item) {
  const requestedUrl = new URL(item.mediaUrl, window.location.href).href;
  if (audio.src !== requestedUrl) {
    audio.src = item.mediaUrl;
    audio.load();
  }
  await waitForMetadata(audio);
}

function positionAtClientTime(manifest) {
  const playlist = manifest.playlist || [];
  const crossfade = manifest.live.crossfadeSeconds;
  let index = manifest.live.current.index;
  let offset = manifest.live.current.offsetSeconds + Math.max(
    0,
    (Date.now() - new Date(manifest.live.serverTime).getTime()) / 1000
  );

  for (let guard = 0; guard < playlist.length * 3; guard += 1) {
    const step = playlist[index].durationSeconds - crossfade;
    if (offset < step) break;
    offset -= step;
    index = (index + 1) % playlist.length;
  }
  return { index, offset };
}

export default function LiveChannelPlayer({ manifest, onPlaybackEvent, onActiveItem, onMessage }) {
  const manifestRef = useRef(manifest);
  const firstAudio = useRef(null);
  const secondAudio = useRef(null);
  const timers = useRef({
    next: null,
    frame: null,
    generation: 0,
    endedAudio: null,
    endedHandler: null
  });
  const [currentIndex, setCurrentIndex] = useState(manifest.live.current.index);
  const [playing, setPlaying] = useState(false);
  const [needsStart, setNeedsStart] = useState(false);
  manifestRef.current = manifest;

  const stopRuntime = useCallback((pauseAudio = true) => {
    timers.current.generation += 1;
    window.clearTimeout(timers.current.next);
    window.cancelAnimationFrame(timers.current.frame);
    if (timers.current.endedAudio && timers.current.endedHandler) {
      timers.current.endedAudio.removeEventListener("ended", timers.current.endedHandler);
    }
    timers.current.endedAudio = null;
    timers.current.endedHandler = null;
    if (pauseAudio) {
      firstAudio.current?.pause();
      secondAudio.current?.pause();
    }
  }, []);

  const playItem = useCallback(async (audio, item, offset, gain) => {
    await prepareItem(audio, item);
    audio.currentTime = Math.min(Math.max(0, offset), Math.max(0, item.durationSeconds - 0.1));
    audio.volume = clampVolume(gain);
    await audio.play();
    onPlaybackEvent(item, "STARTED", audio);
  }, [onPlaybackEvent]);

  const synchronise = useCallback(async () => {
    stopRuntime();
    const generation = timers.current.generation;
    const activeManifest = manifestRef.current;
    const playlist = activeManifest.playlist || [];
    const crossfade = activeManifest.live?.crossfadeSeconds || 2;
    if (!playlist.length || !activeManifest.live) return;

    const scheduleNext = (index, activeSlot, offset) => {
      if (generation !== timers.current.generation) return;
      const item = playlist[index];
      const delayMs = Math.max(0, (item.durationSeconds - crossfade - offset) * 1000);
      const nextIndex = (index + 1) % playlist.length;
      const nextSlot = activeSlot === 0 ? 1 : 0;
      const currentAudio = activeSlot === 0 ? firstAudio.current : secondAudio.current;
      const nextAudio = nextSlot === 0 ? firstAudio.current : secondAudio.current;
      const nextItem = playlist[nextIndex];

      // Load the incoming track while the current one is still playing. Waiting
      // until the two-second transition begins is too late on slower networks.
      const preload = prepareItem(nextAudio, nextItem)
        .then(() => true)
        .catch(() => false);
      let transitionStarted = false;
      const beginTransition = async () => {
        if (generation !== timers.current.generation) return;
        if (transitionStarted) return;
        transitionStarted = true;
        currentAudio.removeEventListener("ended", beginTransition);
        timers.current.endedAudio = null;
        timers.current.endedHandler = null;
        try {
          if (!(await preload)) await prepareItem(nextAudio, nextItem);
          await playItem(nextAudio, nextItem, 0, 0);
          setCurrentIndex(nextIndex);
          onActiveItem(nextItem, nextAudio);
          const currentAlreadyEnded = currentAudio.ended;
          const fadeStarted = performance.now();
          const fade = (now) => {
            if (generation !== timers.current.generation) return;
            const progress = clampVolume((now - fadeStarted) / Math.max(1, crossfade * 1000));
            currentAudio.volume = clampVolume(1 - progress);
            nextAudio.volume = currentAlreadyEnded ? 1 : clampVolume(progress);
            if (progress < 1) {
              timers.current.frame = window.requestAnimationFrame(fade);
              return;
            }
            currentAudio.pause();
            onPlaybackEvent(item, "COMPLETED", currentAudio);
            scheduleNext(nextIndex, nextSlot, crossfade);
          };
          timers.current.frame = window.requestAnimationFrame(fade);
        } catch (error) {
          setPlaying(false);
          setNeedsStart(true);
          onMessage(error instanceof Error ? error.message : "Playback needs to be started.");
        }
      };

      // The clock starts the mix two seconds early. The ended event is a safety
      // net for timer throttling and prevents a channel from remaining silent.
      timers.current.endedAudio = currentAudio;
      timers.current.endedHandler = beginTransition;
      currentAudio.addEventListener("ended", beginTransition, { once: true });
      timers.current.next = window.setTimeout(beginTransition, delayMs);
    };

    const { index, offset } = positionAtClientTime(activeManifest);
    const currentItem = playlist[index];
    const incomingProgress = offset < crossfade ? offset / crossfade : 1;
    try {
      if (offset < crossfade && playlist.length > 1) {
        const previousIndex = (index - 1 + playlist.length) % playlist.length;
        const previousItem = playlist[previousIndex];
        const previousOffset = previousItem.durationSeconds - crossfade + offset;
        await Promise.all([
          playItem(firstAudio.current, previousItem, previousOffset, 1 - incomingProgress),
          playItem(secondAudio.current, currentItem, offset, incomingProgress)
        ]);
        setCurrentIndex(index);
        onActiveItem(currentItem, secondAudio.current);
        const remainingMs = Math.max(0, (crossfade - offset) * 1000);
        const fadeStarted = performance.now();
        const finishIncomingFade = (now) => {
          if (generation !== timers.current.generation) return;
          const progress = remainingMs === 0 ? 1 : Math.min(1, (now - fadeStarted) / remainingMs);
          firstAudio.current.volume = clampVolume((1 - incomingProgress) * (1 - progress));
          secondAudio.current.volume = clampVolume(incomingProgress + (1 - incomingProgress) * progress);
          if (progress < 1) {
            timers.current.frame = window.requestAnimationFrame(finishIncomingFade);
            return;
          }
          firstAudio.current.pause();
          onPlaybackEvent(previousItem, "COMPLETED", firstAudio.current);
          scheduleNext(index, 1, crossfade);
        };
        timers.current.frame = window.requestAnimationFrame(finishIncomingFade);
      } else {
        await playItem(firstAudio.current, currentItem, offset, 1);
        setCurrentIndex(index);
        onActiveItem(currentItem, firstAudio.current);
        scheduleNext(index, 0, offset);
      }
      setPlaying(true);
      setNeedsStart(false);
      onMessage("");
    } catch {
      stopRuntime();
      setPlaying(false);
      setNeedsStart(true);
      onMessage("Press Start live radio to join the channel at its current live position.");
    }
  }, [onActiveItem, onMessage, playItem, stopRuntime]);

  useEffect(() => {
    synchronise();
    return () => stopRuntime();
  }, [manifest.version, manifest.live?.streamId, synchronise, stopRuntime]);

  const current = manifest.playlist[currentIndex] || manifest.playlist[0];

  return <div style={styles.player}>
    <p style={styles.nowPlaying}>Now playing: <strong>{current.artist} — {current.title}</strong></p>
    <div style={styles.statusRow}>
      <span style={styles.liveBadge}>LIVE</span>
      <span>Shared channel clock · {manifest.live.crossfadeSeconds}-second mix</span>
    </div>
    <button type="button" style={styles.button} onClick={() => {
      if (playing) {
        stopRuntime();
        setPlaying(false);
        setNeedsStart(true);
      } else {
        synchronise();
      }
    }}>{playing ? "Pause" : needsStart ? "Start live radio" : "Start live radio"}</button>
    <audio ref={firstAudio} preload="auto" style={styles.hiddenAudio} />
    <audio ref={secondAudio} preload="auto" style={styles.hiddenAudio} />
  </div>;
}

const styles = {
  player: { display: "grid", gap: 14 },
  nowPlaying: { margin: 0, color: "#e2e8f0", lineHeight: 1.5 },
  statusRow: { display: "flex", alignItems: "center", gap: 9, color: "#cbd5e1", fontSize: 13 },
  liveBadge: { borderRadius: 999, padding: "4px 8px", background: "#dc2626", color: "#fff", fontSize: 11, fontWeight: 900, letterSpacing: 0.8 },
  button: { justifySelf: "start", minHeight: 42, border: 0, borderRadius: 8, padding: "9px 14px", background: "#f4b942", color: "#111827", fontWeight: 900, cursor: "pointer" },
  hiddenAudio: { display: "none" }
};
