export function getRequestId(request) {
  return request.headers.get("x-request-id") || "missing-request-id";
}

export function getClientAddress(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export function securityLog(level, event, request, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    requestId: getRequestId(request),
    method: request.method,
    path: new URL(request.url).pathname,
    ...details
  };

  const output = JSON.stringify(entry);

  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.info(output);
  }
}
