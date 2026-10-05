export function correctionsEdgeSigningPrivateKey() {
  const pem = process.env.CORRECTIONS_EDGE_SIGNING_PRIVATE_KEY;
  if (!pem) throw Object.assign(new Error("Secure Edge signing is not configured."), { status: 503 });
  return pem.replace(/\\n/g, "\n");
}
