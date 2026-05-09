import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

/** Repo-root `.env` so `NEXT_PUBLIC_*` matches `apps/server` without duplicating files */
loadEnv({ path: path.join(__dirname, "../../.env") });
loadEnv({ path: path.join(__dirname, "../../.env.local"), override: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@strait-command/shared"],
  reactStrictMode: true,
};

export default nextConfig;
