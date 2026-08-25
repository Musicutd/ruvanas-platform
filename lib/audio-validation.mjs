const formats = {
  mp3: { mimeType: "audio/mpeg", aliases: new Set(["audio/mpeg", "audio/mp3"]) },
  wav: { mimeType: "audio/wav", aliases: new Set(["audio/wav", "audio/x-wav"]) },
  ogg: { mimeType: "audio/ogg", aliases: new Set(["audio/ogg", "application/ogg"]) },
  m4a: { mimeType: "audio/mp4", aliases: new Set(["audio/mp4", "audio/x-m4a", "video/mp4"]) }
};

function extensionOf(fileName) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function ascii(buffer, start, end) {
  return buffer.subarray(start, end).toString("ascii");
}

function hasSignature(buffer, extension) {
  if (extension === "mp3") {
    return ascii(buffer, 0, 3) === "ID3" ||
      (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  }
  if (extension === "wav") {
    return ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WAVE";
  }
  if (extension === "ogg") {
    return ascii(buffer, 0, 4) === "OggS";
  }
  if (extension === "m4a") {
    return buffer.length >= 12 && ascii(buffer, 4, 8) === "ftyp";
  }
  return false;
}

export function validateAudioUpload({ buffer, fileName, claimedType = "" }) {
  const extension = extensionOf(fileName);
  const format = formats[extension];

  if (!format) {
    return { ok: false, error: "Unsupported file type. Use MP3, WAV, OGG, or M4A." };
  }
  if (buffer.length < 12 || !hasSignature(buffer, extension)) {
    return { ok: false, error: "The file contents do not match a supported audio format." };
  }
  if (claimedType && !format.aliases.has(claimedType.toLowerCase())) {
    return { ok: false, error: "The file extension and reported media type do not match." };
  }

  return { ok: true, extension, contentType: format.mimeType };
}
