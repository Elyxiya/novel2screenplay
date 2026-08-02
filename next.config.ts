import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Windows 下 standalone tracing 对原生模块 junction unlink 报 EPERM，暂不启用 standalone
  // serverExternalPackages 让 better-sqlite3 直接从 node_modules 加载，避免 turbopack
  // 将其重写为 .next/node_modules/better-sqlite3-<hash> 而导致加载失败
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
