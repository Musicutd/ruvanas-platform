// Frozen marketing documents from the reviewed public-site commit. Only the
// absolute paid-host login links were changed to the same-origin /login path.
// This manifest contains no filesystem or secret-bearing configuration.
export const PUBLIC_MARKETING_SOURCE_COMMIT = "1829fc908025ad13126721525b8395db0db8ff3b";
export const PUBLIC_MARKETING_DOCUMENTS = Object.freeze({
  "/public-marketing/index.html": Object.freeze({
    file: "index.html", bytes: 81695,
    sha256: "cfc4837426779de1ce6a3e893b5e9272dc14c7ed1603031cf868c33ff6e4c497",
    sourceSha256LF: "a53d2519cc6f22b64cf13bf90c79348706f05b8da3f401b7e24d54a4d57ed528",
    maskedPrices: 35, loginLinks: 5
  }),
  "/public-marketing/how-it-works/index.html": Object.freeze({
    file: "how-it-works/index.html", bytes: 34565,
    sha256: "abad7b5f0ff8a84debf851ced2ee9c6f492bbaf84687a0195eeb35ffdc6d637d",
    sourceSha256LF: "cb09287c146fe6baa722fe87960043da5e2e1c3c688917fb13563e59d9768a23",
    maskedPrices: 0, loginLinks: 2
  })
});

export function publicMarketingDocument(pathname) {
  return typeof pathname === "string" && Object.hasOwn(PUBLIC_MARKETING_DOCUMENTS, pathname)
    ? PUBLIC_MARKETING_DOCUMENTS[pathname] : null;
}
