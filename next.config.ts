import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署：产出自包含的 .next/standalone 服务端产物，运行时不依赖
  // 完整的 node_modules（见 Dockerfile runner 阶段）。better-sqlite3 已在
  // Next 内置的 serverExternalPackages 默认列表中，会被排除出 webpack 打包
  // 并原样 require()，其原生 .node 二进制由 standalone 的依赖追踪一并带上
  // ——已在容器里实测验证（见 Dockerfile 注释）。
  output: "standalone",
};

export default nextConfig;
