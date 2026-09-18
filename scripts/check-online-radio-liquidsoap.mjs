import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { liquidsoapScript } from "../lib/online-radio-output.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "ruvanas-liquidsoap-check-"));
try {
  const playlistPath = path.join(directory, "rotation.m3u");
  const scriptPath = path.join(directory, "source.liq");
  await writeFile(playlistPath, "# Build-time syntax check; no audio or source connection.\n");
  await writeFile(scriptPath, liquidsoapScript({
    playlistPath,
    host: "203.0.113.1",
    port: 8393,
    username: null,
    password: "build-check-only",
    bitrateKbps: 128,
    stationName: "Ruvanas build check"
  }));
  const result = spawnSync("liquidsoap", ["--check", scriptPath], { stdio: "ignore", timeout: 30_000 });
  if (result.status !== 0) throw new Error("Liquidsoap cannot validate the Ruvanas Online Radio encoder script and MP3 output.");
  console.log("Online Radio Liquidsoap script and MP3 output passed build-time validation.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
