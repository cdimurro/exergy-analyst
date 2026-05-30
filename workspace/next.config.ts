import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

const makeConfig = (phase: string): NextConfig => ({
  // Keep the development server cache separate from production builds.
  // Running `next build` while `next dev` is alive can otherwise replace
  // server chunks under .next and make API routes return MODULE_NOT_FOUND.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  // Standalone output for Docker deployment
  output: "standalone",
  // Allow reading from the parent directory's runtime/ for artifacts
  serverExternalPackages: ["@react-pdf/renderer"],
  // Disable image optimization (no edge CDN on Render)
  images: {
    unoptimized: true,
  },
});

export default makeConfig;
