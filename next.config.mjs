/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/public-marketing/[[...path]]": ["./assets/private-preview-public-site/**/*"]
  },
  experimental: {
    // Bulk accepts a 150 MiB ZIP + 10 MiB manifest and multipart overhead,
    // with a 165 MiB actual request cap. Next silently truncates its clone:
    // 166 MiB provides headroom; strict declared/consumed length validation
    // also rejects truncated clones (headroom alone cannot do so). This
    // global ceiling is a memory tradeoff, NOT an extra upload allowance:
    // middleware permits 165 MiB only for bulk POST, 55 MiB for single upload,
    // and 10 MiB elsewhere; bulk parsing is serialized after admin auth.
    middlewareClientMaxBodySize: "166mb"
  }
};

export default nextConfig;
