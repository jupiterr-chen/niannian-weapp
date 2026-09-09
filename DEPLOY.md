# 部署与运维

部署位置：`<user>@<nas-ip>:<deploy-dir>`
访问地址：**http://<nas-ip>:3000**

---

## 手机 / 平板怎么用

1. 用浏览器打开 `http://<nas-ip>:3000`
2. Safari：分享 → 添加到主屏幕；Chrome：菜单 → 添加到主屏幕
3. 之后从桌面图标进入，全屏无地址栏，和 App 一样

> 家里如果有设备配了代理（本机就跑着一个 `<nas-ip>:1081`），要把 `192.168.*` 加进代理的绕过列表，否则请求会被代理吞掉、页面一直转圈。**这个坑在联调时真实踩到过**：TCP 端口通、HTTP 却超时，症状很有迷惑性。

---

## 日常运维

```bash
ssh <user>@<nas-ip>
cd <deploy-dir>
```

| 目的 | 命令 |
|---|---|
| 看状态 | `docker compose ps` |
| 看日志 | `docker compose logs -f app` |
| 重启 | `docker compose restart` |
| 停止 | `docker compose down` |
| 启动 | `docker compose up -d` |

宿主机重启后会自动拉起（Docker 已设开机自启 + 容器 `restart: unless-stopped`），不需要手工干预。

---

## 更新代码

在开发机上改完、本机验证通过后：

```bash
tar -czf - --exclude=./node_modules --exclude=./.next --exclude=./data \
    --exclude=./.git --exclude=./.env.local . \
  | ssh <user>@<nas-ip> 'tar -xzf - -C <deploy-dir>'
```

```bash
ssh <user>@<nas-ip> 'cd <deploy-dir> && docker compose up -d --build'
```

`.env.local` 有意排除在传输之外——密钥只在首次部署时传一次，避免每次更新都在网络上多传一遍。改了密钥再单独 `scp` 并 `chmod 600`。

---

## 备份

所有状态都在一个目录里，拷走它就是完整备份：

```bash
ssh <user>@<nas-ip> 'cd <deploy-dir> && tar -czf - data' > tingxie-backup-$(date +%F).tar.gz
```

里面是：`app.db`（作业、词库、会话、生词本）、`images/`（作业照片）、`audio/`（语音缓存）。

音频缓存丢了不要紧，会自动重新合成；数据库丢了才是真丢。当前体积约 1.3 MB，长期也就几十兆量级。

---

## 故障排查

**页面打不开，但 `docker compose ps` 显示 healthy**
先排除代理（见上）。再确认防火墙放行 3000 端口。

**上传作业报「服务器出错了」**
`docker compose logs --tail=50 app` 看原始异常。常见原因是方舟 API Key 失效或额度用尽——错误信息里会带方舟返回的原文。

**听写只有「滴滴」提示音**
说明降级成 mock provider 了，即 `.env.local` 里的 `VOLC_TTS_API_KEY` 或 `VOLC_TTS_SPEAKER` 没读到。容器启动日志会打印明确的中文降级原因。

**SQLite 报 `SQLITE_CANTOPEN` 或 `EACCES`**
数据目录属主不对。容器入口脚本会 `chown` 到 uid 1000，但如果 `data/` 落在特殊挂载的文件系统上可能静默失败：
```bash
sudo chown -R 1000:1000 <deploy-dir>/data
```

---

## 可选：用 Tailscale 换真实 HTTPS

这台机器已经在 Tailscale 网络里（`<tailnet-ip>`）。用它可以拿到一张**受信任的真实证书**，不用自签、不用在每台设备装根证书：

```bash
ssh <user>@<nas-ip> 'sudo tailscale serve --bg --https=443 3000'
```

之后用 `https://<机器名>.<tailnet>.ts.net` 访问。这么做能解锁三样纯 http 下拿不到的能力：

- **屏幕常亮**（Screen Wake Lock 需要安全上下文）—— 孩子写字时不碰屏幕，现在会息屏
- Service Worker 离线缓存
- Android Chrome 的「安装应用」提示

不做也完全能用，只是少这几项。局域网 http 下听写、识别、缓存全部正常。
