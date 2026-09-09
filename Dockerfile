# 基础镜像：node:22-bookworm-slim
#
# 选型理由：
#   - 目标机是 Debian 12 (bookworm) x86_64 —— 用同底的 *-bookworm-slim 镜像，
#     glibc/内核 ABI 与目标机一致，不会出现「本机镜像能跑、目标机不能跑」
#     这类底层差异。
#   - Node 22 是当前 LTS，满足 better-sqlite3@13 声明的 "engines": {"node":
#     ">=22"}。
#   - 关键考量——better-sqlite3 有没有预编译包：**实测过，结论分两层**（完整
#     记录见文件末尾「踩坑记录」）：
#       1) npm 安装阶段：better-sqlite3 的 package.json 里 `"gypfile": true`
#          会让 npm 在 install 时无条件跑一遍 `node-gyp rebuild`，不管本地
#          有没有能用的预编译文件。这一步没有 Python3 + C/C++ 编译器就直接
#          报错、`npm ci` 整体失败——实测在没装 python3/make/g++ 的
#          node:22-bookworm-slim 上必现。所以 deps/builder 阶段必须装它们。
#       2) 运行阶段：better-sqlite3 的 npm 包本身在 `prebuilds/` 目录里随包
#          附带了 linux-x64 等常见平台的现成 .node 二进制，`lib/binding.js`
#          优先找这个目录，找到就直接用，根本不会走到 `build/Release/`。
#          实测这份 prebuilds/linux-x64.node 在 Debian 12 + Node 22 的
#          runner 容器里直接可用。
#     两条合起来：build 阶段需要编译工具链（只是为了让 npm ci 不中途报
#     错），但最终跑起来的原生二进制其实是包自带的、不是本地编译出来的；
#     runner 阶段不需要装任何编译工具，最终镜像保持干净。
#   - Debian 官方镜像自带 uid=1000 的 "node" 用户和 /usr/bin/su，运行时用它
#     降权，不必自己 useradd。

############################################################
# deps：只装依赖，产出全量 node_modules（含 devDependencies，build 要用）。
############################################################
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# 见本文件顶部说明：better-sqlite3 的 gypfile 安装钩子无条件跑 node-gyp
# rebuild，没有 Python3 + 编译器 npm ci 直接失败（实测）。只装在这一层，
# 不会进最终的 runner 镜像。
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

############################################################
# builder：编译 Next.js standalone 产物
############################################################
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

############################################################
# runner：只拷贝运行时需要的东西，非 root 用户运行
############################################################
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV TZ=Asia/Shanghai
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# next.config.ts 里 output:"standalone" 产出的服务端产物是自包含的：
# server.js 加一份已被 tracing 裁剪过的 node_modules。better-sqlite3 在
# Next 内置的 serverExternalPackages 默认名单里，不会被打包进 bundle；
# 实测确认 standalone 产物里 node_modules/better-sqlite3/prebuilds/ 下的
# .node 二进制被完整保留（见「踩坑记录」），不需要额外手动 COPY 覆盖，
# 也就不用把 builder 阶段里 build/ 编译中间产物（obj.target、.deps 等，
# 与最终二进制无关的体积）带进最终镜像。
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data \
    && chown -R node:node /app /data

EXPOSE 3000

# 打首页即可；用 Node 内置 fetch 而不是 curl/wget，省得为了一次健康检查
# 在最终镜像里多装一个包。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 容器以 root 启动（entrypoint 需要 root 权限 chown bind mount 出来的
# /data，见 docker-entrypoint.sh 注释），entrypoint 内部会立刻 su 到内置的
# node 用户（uid 1000）去跑 node server.js —— 真正处理请求、读写数据库/
# 图片/音频的进程始终是非 root。
ENTRYPOINT ["docker-entrypoint.sh"]

############################################################
# 踩坑记录（构建 + 运行验证过程中的真实问题，供部署时排查参考。全部是本次
# 实测遇到的，不是理论推测）：
#
# 1. `npm ci` 在裸的 node:22-bookworm-slim 上直接失败
#    现象：deps 阶段报
#      "gyp ERR! find Python You need to install the latest version of
#      Python." → npm ci 以 exit code 1 结束，整个构建在最早期就中止。
#    原因：better-sqlite3 声明了 gypfile，npm install 会自动跑一遍
#    `node-gyp rebuild`，这一步不管三七二十一都要找 Python3；镜像里没有。
#    修法：deps 阶段 `apt-get install -y python3 make g++`（本 Dockerfile
#    已加），只装这一层，不进 runner。
#
# 2. .dockerignore 排除 tests/ 导致 `next build` 直接报 Module not found
#    现象：`lib/vlm/mock.ts` 生产代码里直接 `import { REQUIRED_WORDS, ROWS }
#    from "../../tests/fixtures/worksheet-01"`，这不是测试专用文件，是 mock
#    VLM provider 的黄金真值数据源（避免测试和 mock 数据两处手抄不一致）。
#    第一版 .dockerignore 图省事把整个 tests/ 都排除了，直接导致 builder
#    阶段构建失败。
#    修法：.dockerignore 只排除 tests 下的覆盖率产物（coverage/），不排除
#    tests/ 本身；见该文件里的说明注释。
#
# 3.（验证性结论，不是缺陷）standalone 产物是否带全 better-sqlite3 的原生
#    二进制——最初担心 node-file-trace 对原生模块的非 JS 文件追踪不全，
#    实测后确认*不需要*额外处理：容器起来后 `find /app/node_modules/
#    better-sqlite3` 能看到 `prebuilds/linux-x64.node`（约 2.2MB，真实二进
#    制，不是占位文件），GET /api/history 之类会触碰数据库的接口在无额外
#    干预下直接返回 200。原因见本文件顶部「基础镜像选型」第二条。
############################################################
