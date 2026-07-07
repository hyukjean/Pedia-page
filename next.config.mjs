// First principle: prompts are content, not code. They live in /prompts as
// plain files, so Vercel's file tracer must be told to ship them. Keys must
// be the exact route paths — glob keys silently fail to match app routes,
// and the function then dies with ENOENT at runtime.
const prompts = ["./prompts/**/*"];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/answer": prompts,
    "/api/card": prompts,
    "/api/synthesis": prompts,
    "/api/export": prompts,
    "/api/recommend": prompts,
  },
};

export default nextConfig;
