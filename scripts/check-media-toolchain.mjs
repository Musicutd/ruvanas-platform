import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { validateMediaToolVersion } from "../lib/release-quality.mjs";

const tools = [
  { name: "ffmpeg", executable: ffmpegPath },
  { name: "ffprobe", executable: ffprobeStatic.path }
];

const versions = {};
for (const tool of tools) {
  if (!tool.executable) throw new Error(`${tool.name} executable is unavailable for this platform.`);
  const result = spawnSync(tool.executable, ["-version"], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${tool.name} exited with status ${result.status}: ${String(result.stderr || "").trim()}`);
  versions[tool.name] = validateMediaToolVersion(tool.name, result.stdout);
}

process.stdout.write(JSON.stringify({ event: "media_toolchain_verified", versions }) + "\n");
