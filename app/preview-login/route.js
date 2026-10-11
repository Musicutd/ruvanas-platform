import { readPrivatePreviewPolicy } from "@/lib/private-preview-policy.mjs";

export const dynamic = "force-dynamic";

const SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store, max-age=0",
  "content-security-policy": "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow, noarchive"
});

const ERROR_MESSAGES = Object.freeze({
  invalid: "That access code is invalid, expired, or already used.",
  "rate-limited": "Too many attempts. Please wait and try again.",
  unavailable: "Private preview access is temporarily unavailable. Please try again later."
});

function page(errorCode) {
  const message = Object.hasOwn(ERROR_MESSAGES, errorCode) ? ERROR_MESSAGES[errorCode] : "";
  const feedback = message ? `<p class="feedback" role="alert">${message}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Private preview sign in — Ruvanas</title>
  <style>
    :root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#101827;color:#fff;display:grid;place-items:center;padding:1.25rem}
    main{width:min(100%,27rem);padding:2.2rem;border:1px solid #26344d;border-radius:1rem;background:#182235;box-shadow:0 1.25rem 3.5rem #0007}
    .brand{color:#f4b942;font-size:1.2rem;font-weight:800;letter-spacing:.125em}
    h1{font-size:1.7rem;line-height:1.2;margin:1.75rem 0 .45rem}p{line-height:1.5;color:#bac7d8;margin:.55rem 0 1.4rem}
    label{display:block;font-weight:650;margin:1.1rem 0 .4rem}input{width:100%;font:inherit;color:#fff;background:#08111e;border:1px solid #6d7d94;border-radius:.5rem;padding:.78rem .85rem}
    input:focus-visible,button:focus-visible{outline:3px solid #f4b942;outline-offset:2px}button{width:100%;font:inherit;font-weight:750;color:#101827;background:#f4b942;border:0;border-radius:.5rem;padding:.85rem;margin-top:1.5rem;cursor:pointer}
    .feedback{color:#ffe2d8;background:#5e241f;border:1px solid #db7b69;border-radius:.5rem;padding:.8rem;margin:1rem 0}
    .foot{font-size:.85rem;color:#a6b5c9;margin:1.5rem 0 0}
  </style>
</head>
<body>
  <main>
    <div class="brand">RUVANAS</div>
    <h1>Private app preview</h1>
    <p>Enter the one-use code privately provided by the Ruvanas owner to view the current app preview. Codes expire after 24 hours.</p>
    ${feedback}
    <form method="post" action="/api/auth/preview-code" autocomplete="on">
      <label for="code">Private access code</label>
      <input id="code" name="code" type="password" autocomplete="one-time-code" maxlength="52" autocapitalize="off" spellcheck="false" required>
      <button type="submit">Open preview</button>
    </form>
    <p class="foot">Access is limited to the owner and invited testers. Ask the owner for a new code if yours has expired.</p>
  </main>
</body>
</html>`;
}

function responseFor(request, head = false) {
  const policy = readPrivatePreviewPolicy(process.env);
  if (!policy.enabled) return new Response(null, { status: 404, headers: SECURITY_HEADERS });
  if (!policy.valid) {
    return new Response(head ? null : "Private preview temporarily unavailable.", {
      status: 503,
      headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" }
    });
  }
  const errorCode = new URL(request.url).searchParams.get("error");
  return new Response(head ? null : page(errorCode), { status: 200, headers: SECURITY_HEADERS });
}

export function GET(request) {
  return responseFor(request);
}

export function HEAD(request) {
  return responseFor(request, true);
}
