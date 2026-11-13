import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The current Mini App is entirely static; keep the usual Next.js server
  // available locally and produce a portable export only for deployment.
  output: process.env.UWELNES_STATIC_EXPORT === "1" ? "export" : undefined,
  rewrites:
    process.env.UWELNES_STATIC_EXPORT === "1"
      ? undefined
      : async () => [
          {
            source: "/api/:path*",
            destination: "http://127.0.0.1:8000/api/:path*",
          },
        ],
  // Only this development tunnel may access Next.js dev resources.
  // Update the hostname if the temporary Cloudflare tunnel changes.
  allowedDevOrigins: ["pixel-isaac-sounds-exit.trycloudflare.com"],
};

export default nextConfig;
