import { createConnection } from "node:net";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_AUDIO = new Set([".mp3", ".aac", ".m4a", ".wav", ".flac", ".ogg"]);

export function studioQueuePushCommand(mediaPath, privateDirectory) {
  if (typeof mediaPath !== "string" || typeof privateDirectory !== "string" ||
      !path.isAbsolute(mediaPath) || !path.isAbsolute(privateDirectory) ||
      /[\r\n\0]/.test(mediaPath) || /[\r\n\0]/.test(privateDirectory)) {
    throw new Error("Studio output needs an absolute, local protected audio path.");
  }
  const relative = path.relative(privateDirectory, mediaPath);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
      !SUPPORTED_AUDIO.has(path.extname(mediaPath).toLowerCase())) {
    throw new Error("Studio output accepts only protected audio inside its private cache.");
  }
  return `studio_manual.push ${mediaPath}\n`;
}

export function parseStudioQueuePushReply(reply) {
  const lines = String(reply).replaceAll("\r", "").trim().split("\n");
  if (lines.length !== 2 || !/^[0-9]+$/.test(lines[0]) || lines[1] !== "END") {
    throw new Error("The encoder did not acknowledge the Studio queue request.");
  }
  // A request ID means only that Liquidsoap accepted a queue request. It is
  // never evidence that Centova or a listener received audio.
  return { requestId: lines[0], listenerVerified: false };
}

export function sendStudioQueuePush(socket, command, { timeoutMs = 3000, connect = createConnection } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) throw new Error("Invalid encoder response timeout.");
  if (typeof socket !== "string" || !path.isAbsolute(socket) || typeof command !== "string" || !/^studio_manual\.push [^\r\n\0]+\n$/.test(command)) {
    throw new Error("Invalid private Studio queue command.");
  }
  return new Promise((resolve, reject) => {
    const connection = connect(socket);
    let settled = false;
    let response = "";
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      connection.destroy();
      if (error) reject(error); else resolve(result);
    };
    connection.setTimeout(timeoutMs, () => finish(new Error("The Studio encoder queue did not respond in time.")));
    connection.on("connect", () => connection.write(command));
    connection.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 1024) return finish(new Error("The Studio encoder queue response was too large."));
      if (/(?:^|\n)END\r?\n?$/.test(response)) {
        try { finish(null, parseStudioQueuePushReply(response)); }
        catch (error) { finish(error); }
      }
    });
    connection.on("error", (error) => finish(error));
    connection.on("end", () => {
      if (!settled) finish(new Error("The Studio encoder closed before acknowledging the queue request."));
    });
  });
}

export async function pushPreparedStudioAudio({ socketPath, mediaPath, privateDirectory, timeoutMs = 3000 }) {
  const [cache, media, socket] = await Promise.all([realpath(privateDirectory), realpath(mediaPath), realpath(socketPath)]);
  const [cacheStat, mediaStat, socketStat] = await Promise.all([stat(cache), stat(media), stat(socket)]);
  if (!cacheStat.isDirectory() || !mediaStat.isFile() || !socketStat.isSocket() || path.dirname(socket) !== cache ||
      (cacheStat.mode & 0o077) !== 0 || (mediaStat.mode & 0o077) !== 0 || (socketStat.mode & 0o077) !== 0) {
    throw new Error("The Studio encoder socket and audio must be in its private cache.");
  }
  return sendStudioQueuePush(socket, studioQueuePushCommand(media, cache), { timeoutMs });
}
