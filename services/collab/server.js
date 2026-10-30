/**
 * YYC³ CRDT 协作服务（collab）
 *
 * 作用：为前端 pai.yyc3.vip 提供带房间令牌鉴权的 y-websocket 协作服务。
 * 前端已就绪：VITE_COLLAB_WS_URL / VITE_COLLAB_ROOM_TOKEN（见 YYC3-PAI-AI
 * docs/YYC3-生产落地总账-20261030.md）。
 *
 * 鉴权模型（与前端 withRoomToken 对齐）：
 *   客户端连接 ws://host/room/<docId>?token=<roomToken>
 *   服务端校验 token ∈ COLLAB_TOKENS（逗号分隔）或 HMAC(房间号, SECRET)
 *   校验失败：握手期 401 关闭，不进入房间。
 *
 * 运行：node server.js （PORT/COLLAB_TOKENS/COLLAB_SECRET 环境变量）
 */

const { WebSocketServer } = require('ws')
const crypto = require('crypto')

const PORT = Number(process.env.PORT || 8080)
// 模式一：静态令牌白名单（逗号分隔），适用于个人/小团队部署
const STATIC_TOKENS = new Set(
  (process.env.COLLAB_TOKENS || '').split(',').map(s => s.trim()).filter(Boolean)
)
// 模式二：HMAC 房间令牌 —— token == HMAC-SHA256(secret, roomId) 的 hex 前 32 位
const SECRET = process.env.COLLAB_SECRET || ''

function authorize(roomId, token) {
  if (!token) return false
  if (STATIC_TOKENS.has(token)) return true
  if (SECRET) {
    const expect = crypto.createHmac('sha256', SECRET).update(roomId).digest('hex').slice(0, 32)
    if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(token.padEnd(expect.length).slice(0, expect.length)))) {
      return expect === token
    }
  }
  return false
}

const wss = new WebSocketServer({ noServer: true })
const rooms = new Map() // roomId -> Set<ws>

function broadcast(roomId, sender, data) {
  const set = rooms.get(roomId)
  if (!set) return
  for (const client of set) {
    if (client !== sender && client.readyState === 1) client.send(data)
  }
}

wss.on('connection', (ws) => {
  // 鉴权已在 upgrade 阶段完成（见下），此处仅登记房间
  const roomId = ws.roomId
  if (!rooms.has(roomId)) rooms.set(roomId, new Set())
  rooms.get(roomId).add(ws)

  ws.on('message', (data) => {
    // y-sync 协议为端到端消息：服务端仅做受信转发（不解析文档内容）
    broadcast(roomId, ws, data)
  })

  ws.on('close', () => {
    const set = rooms.get(roomId)
    if (set) {
      set.delete(ws)
      if (set.size === 0) rooms.delete(roomId)
    }
  })
})

// 与 HTTP 服务共端口的路由挂载点（Platform 网关反代 /collab/ws 时使用）
const http = require('http')
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ service: 'yyc3-collab', rooms: rooms.size }))
})
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/room/')) {
    socket.destroy()
    return
  }
  const roomId = url.pathname.replace(/^\/room\//, '').replace(/\/+$/, '')
  const token = url.searchParams.get('token') || ''
  // 鉴权前移：握手期直接 401，未授权连接不进入 WebSocket 生命周期
  if (!roomId || !authorize(roomId, token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.roomId = roomId
    wss.emit('connection', ws, req)
  })
})

server.listen(PORT, () => {
  console.log(`[yyc3-collab] listening on :${PORT} (static tokens: ${STATIC_TOKENS.size}, hmac: ${SECRET ? 'on' : 'off'})`)
})
