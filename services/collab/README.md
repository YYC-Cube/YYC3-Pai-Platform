# YYC³ CRDT 协作服务（collab）

为前端 `pai.yyc3.vip`（YYC3-PAI-AI）提供**房间令牌鉴权**的 y-websocket 协作服务。前端已就绪：`VITE_COLLAB_WS_URL` / `VITE_COLLAB_ROOM_TOKEN`（见前端仓 `docs/YYC3-生产落地总账-20261030.md`）。

## 连接协议

```
ws://<host>:8090/room/<docId>?token=<roomToken>
```

- 校验失败：握手即以 `4401 invalid room token` 关闭，不进入房间；
- 校验通过：服务端做**受信转发**（不解析 y-sync 文档内容，零知识）；
- HTTP `GET /`：健康检查（返回 `{service, rooms}`）。

## 令牌模型（二选一或并用）

| 模式 | 环境变量 | 说明 |
|---|---|---|
| 静态白名单 | `COLLAB_TOKENS=tok1,tok2` | 个人/小团队部署最简形态 |
| HMAC 房间令牌 | `COLLAB_SECRET=<随机串>` | `token = HMAC-SHA256(secret, roomId).hex[:32]`，按房间签发（Platform 网关后续可加 `/collab/token` 签发端点） |

## 部署

```bash
# docker compose（已挂入 docker/docker-compose.yml 的 collab 服务）
YYC3_COLLAB_TOKENS=my-secret-room-token docker compose -f docker/docker-compose.yml up -d collab

# 裸机
cd services/collab && npm ci --omit=dev
PORT=8080 COLLAB_TOKENS=my-secret-room-token node server.js
```

## 前端对接

```env
# YYC3-PAI-AI 仓库 .env.production
VITE_COLLAB_WS_URL=wss://collab.yyc3.vip   # 或 ws://nas-host:8090
VITE_COLLAB_ROOM_TOKEN=my-secret-room-token
```

## 安全说明

- 未配置任何令牌源时**拒绝所有连接**（fail-closed）；
- 服务端不落盘、不解析文档内容（转发层零知识）；
- 生产建议置于 TLS 终止（反代 wss）之后。
