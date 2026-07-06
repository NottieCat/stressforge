import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Two lockfiles exist (repo root + web/); pin the Turbopack root to this app
  // so Next doesn't infer the wrong workspace root.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
