// Frozen marketing documents retain the reviewed public-site commit as provenance.
// Login links use /login; the reviewed Retail revision aligns its five tiers
// with Focused catalogue access and pauses Retail digital display offerings.
// This manifest contains no filesystem or secret-bearing configuration.
export const PUBLIC_MARKETING_SOURCE_COMMIT = "1829fc908025ad13126721525b8395db0db8ff3b";
export const PUBLIC_MARKETING_DOCUMENTS = Object.freeze({
  "/public-marketing/index.html": Object.freeze({
    file: "index.html", bytes: 81281,
    sha256: "a13287d77e4a9c8cc00dc230279256cf3dc891ea33720420f312fb1a83901c05",
    reviewedRevision: "RETAIL_FOCUSED_AUDIO_ONLY_V1",
    unchangedOutsideRetailSha256LF: "a2953efb78b98b88c4e759a92f053e6065ce26949cdb63d8d8b28fb11fa7bb47",
    sourceSha256LF: "a53d2519cc6f22b64cf13bf90c79348706f05b8da3f401b7e24d54a4d57ed528",
    maskedPrices: 35, loginLinks: 5
  }),
  "/public-marketing/how-it-works/index.html": Object.freeze({
    file: "how-it-works/index.html", bytes: 34544,
    sha256: "8177e0132c0a8cace70b5421be52c8c456538437f337e878c008b12ff6cdcdd2",
    reviewedRevision: "RETAIL_FOCUSED_AUDIO_ONLY_V1",
    unchangedOutsideRetailSha256LF: "94bb6f4799379636704b986741d5f41585619c8f681bce7cac08d866984311d7",
    sourceSha256LF: "cb09287c146fe6baa722fe87960043da5e2e1c3c688917fb13563e59d9768a23",
    maskedPrices: 0, loginLinks: 2
  })
});

export function publicMarketingDocument(pathname) {
  return typeof pathname === "string" && Object.hasOwn(PUBLIC_MARKETING_DOCUMENTS, pathname)
    ? PUBLIC_MARKETING_DOCUMENTS[pathname] : null;
}
