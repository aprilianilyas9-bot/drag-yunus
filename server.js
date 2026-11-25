// Server Mabar Drag Yunus: serve game + WebSocket di path /ws
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = 4;
const INDEX = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(f => fs.existsSync(f)) || path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html') {
    return fs.readFile(INDEX, (e, d) => {
      if (e) { res.writeHead(500); return res.end('index.html tidak ada'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(d);
    });
  }
  res.writeHead(404); res.end('404');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
const rooms = new Map(); // nama -> { members: Set<ws>, host: ws }
let nextId = 1;

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const cleanName = s => String(s || '').trim().slice(0, 16);

function leave(ws) {
  const r = ws.room && rooms.get(ws.room);
  ws.room = null;
  if (!r) return;
  r.members.delete(ws);
  if (!r.members.size) return void rooms.delete(r.name);
  if (r.host === ws) {
    r.host = [...r.members][0];
    send(r.host, { k: 'host' });
  }
}

function relay(ws, obj, binary) {
  const r = ws.room && rooms.get(ws.room);
  if (!r) return;
  const data = binary || JSON.stringify(obj);
  for (const m of r.members) if (m !== ws && m.readyState === 1) m.send(data);
}

wss.on('connection', ws => {
  ws.id = 'P' + (nextId++).toString(36);
  ws.room = null;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  send(ws, { k: 'hi', id: ws.id });

  ws.on('message', (raw, isBinary) => {
    // Suara: klien kirim [1, ...audio]; server teruskan [2, id(12 byte), ...audio]
    if (isBinary) {
      if (!ws.room || raw.length < 2 || raw.length > 4000 || raw[0] !== 1) return;
      const out = Buffer.alloc(13 + raw.length - 1, 0x20);
      out[0] = 2;
      out.write(ws.id, 1, 'latin1');
      raw.copy(out, 13, 1);
      return relay(ws, null, out);
    }
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;

    switch (m.k) {
      case 'ping': break;
      case 'list':
        send(ws, { k: 'rooms', r: [...rooms.values()].map(r => ({ n: r.name, c: r.members.size })) });
        break;
      case 'join': {
        const name = cleanName(m.n);
        if (!name) return send(ws, { k: 'err', m: 'NAMA ROOM KOSONG' });
        if (ws.room) leave(ws);
        let r = rooms.get(name);
        if (m.m === 'create') {
          if (r) return send(ws, { k: 'err', m: 'NAMA ROOM SUDAH DIPAKAI' });
          r = { name, members: new Set(), host: ws };
          rooms.set(name, r);
        } else {
          if (!r) return send(ws, { k: 'err', m: 'ROOM TIDAK DITEMUKAN' });
          if (r.members.size >= MAX_PER_ROOM) return send(ws, { k: 'err', m: 'ROOM PENUH (MAKS 4)' });
        }
        r.members.add(ws);
        ws.room = name;
        send(ws, { k: 'joined', host: r.host === ws });
        break;
      }
      case 'leave': leave(ws); break;
      case 'p': // posisi pemain
      case 'e': // event: chat, ajak balap, dll
        if (m.d && typeof m.d === 'object') {
          m.d.i = ws.id; // id selalu dari server, anti-spoof
          relay(ws, { k: m.k, d: m.d });
        }
        break;
      case 'f': // foto muka
        if (typeof m.d === 'string' && m.d.length <= 7000) relay(ws, { k: 'f', i: ws.id, d: m.d });
        break;
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// Buang koneksi mati
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log('Server jalan di port ' + PORT));
