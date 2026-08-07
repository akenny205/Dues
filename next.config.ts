import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Pin the workspace root explicitly — there's a stray package-lock.json in the
  // parent home directory that Next's auto-detection otherwise picks up instead,
  // which can lead Turbopack's dev file-watcher/cache astray.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
