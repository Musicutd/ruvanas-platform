/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/public-marketing/[[...path]]": ["./assets/private-preview-public-site/**/*"]
  },
  experimental: {
    // The Super Admin single-track form accepts a 50 MB audio file. Next.js
    // otherwise truncates multipart requests at its 10 MB middleware default.
    middlewareClientMaxBodySize: "55mb"
  }
};

export default nextConfig;
