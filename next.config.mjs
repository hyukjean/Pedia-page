/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // First principle: prompts are content, not code. They live in /prompts as
  // plain files, so Vercel's file tracer must be told to ship them.
  outputFileTracingIncludes: {
    "/api/**/*": ["./prompts/**/*"],
  },
};

export default nextConfig;
