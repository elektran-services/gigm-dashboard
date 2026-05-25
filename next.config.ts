import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

/** App directory (gigm-dashboard), not the parent GIGM folder. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Production VPS often has no committed env file unless you create one on the server.
// Next.js reads env files automatically, but explicitly loading here guarantees SMTP/monitor
// vars exist when only `.env.local` or `.env.production` is present in the app directory.
loadEnv({ path: path.join(projectRoot, ".env.production") });
loadEnv({ path: path.join(projectRoot, ".env.local"), override: true });

const nextConfig: NextConfig = {
  // Monorepo-style layout: repo is GIGM/gigm-dashboard — pin root so @import "tailwindcss" resolves here.
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      tailwindcss: path.join(projectRoot, "node_modules/tailwindcss"),
    },
  },
  // Heavy native-ish deps: keep them external for faster, more reliable server bundles.
  serverExternalPackages: ["exceljs", "unzipper", "fstream"],
};

export default nextConfig;
