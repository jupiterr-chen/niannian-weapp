#!/bin/sh
# 容器以 root 启动，只做一件 root 才能做的事——修好 bind mount 目录的属主，
# 然后立刻降权到内置的 node 用户（uid 1000）去跑真正的服务进程。
#
# 为什么需要这一步：docker-compose.yml 用 bind mount（./data:/data）而不是
# named volume（部署选型见 docker-compose.yml 注释）。bind mount 的属主由
# *宿主机* 决定，构建镜像时在 runner 阶段 chown 的 /data 只是镜像层里的占位
# 目录，容器启动后会被宿主机目录整个盖掉。如果宿主机上 ./data 是被 root
# （比如 docker compose 自动创建目录）或非 1000 的用户创建的，容器内以 uid
# 1000 直接跑 node 进程会在第一次写 SQLite/图片/音频时得到 EACCES，且这个
# 报错只会在真实部署的宿主机上出现——本机 Windows 挂载出来的目录不受
# Linux uid/gid 语义约束，会掩盖这个问题，所以必须在这里兜底，不能省略。
set -e

mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR" 2>/dev/null || true

exec su -s /bin/sh node -c "exec node server.js"
