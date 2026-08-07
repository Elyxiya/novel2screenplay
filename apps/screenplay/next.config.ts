import type { NextConfig } from "next";
import path from "path";

// 共享包 dist 目录（workspace 链接在部分环境解析不可靠，显式别名兜底）
const contractsDist = path.resolve(__dirname, "../..", "packages/contracts/dist");
const authDist = path.resolve(__dirname, "../..", "packages/auth/dist");

const nextConfig: NextConfig = {
  // 沙箱构建机对 ".next" 目录的高频并发写入支持异常（写后读 ENOENT），
  // 改用非默认目录名规避；dev/build 分目录，避免 dev 清理缓存时误伤构建产物，
  // 也避开早期 Turbopack 在 .next-prod/dev 留下的幽灵目录（unlink EPERM / 写后读 ENOENT）
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next-build",
  // 沙箱构建机可用内存有限（~2GB 空闲），限制 page-data 收集 worker 数避免 OOM
  experimental: {
    cpus: 1,
    // 沙箱对子进程（child_process fork）的文件系统视图隔离导致 worker 读不到
    // 编译产物（写后读 ENOENT），改用同进程 worker_threads 共享视图
    workerThreads: true,
  },
  // Windows 下 standalone tracing 对原生模块 junction unlink 报 EPERM，暂不启用 standalone
  // serverExternalPackages 让 better-sqlite3 直接从 node_modules 加载，避免 turbopack
  // 将其重写为 .next/node_modules/better-sqlite3-<hash> 而导致加载失败
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config, { isServer, dev }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@novel/contracts": contractsDist,
      "@novel/auth": authDist,
    };
    // dev(webpack) 模式下 Next 对 server bundle 的 node 内置模块 external 处理缺失
    // （报 Can't resolve 'path'），显式补上 externalsPresets.node
    if (isServer && dev) {
      config.externalsPresets = { ...config.externalsPresets, node: true };
    }
    return config;
  },
  // 注意：@novel/* 的运行时解析在 dev(Turbopack) 下走 tsconfig paths（相对路径），
  // 不用 turbopack.resolveAlias 绝对路径——Turbopack 在 Windows 上不支持
  // 绝对路径 import（"windows imports are not implemented yet"）。
};

export default nextConfig;
