// =============================================================
//  Sunucu Girişi
// =============================================================
//  HTTP (REST API + auth) ve WebSocket (realtime) aynı portta.
//  Kalıcı durum SQLite'ta (db.js). Medya P2P akar; sunucu sadece
//  hesap/sunucu/kanal/text ve WebRTC signaling işini yapar.
// =============================================================

const http = require('http');
const express = require('express');
const path = require('path');

require('./db'); // şemayı hazırla
const auth = require('./auth');
const api = require('./api');
const realtime = require('./realtime');

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json({ limit: '32mb' }));

// CORS (Electron renderer file:// kökeninden istek atar)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', auth.router);
app.use('/api', api.router);

app.use((req, res) => res.status(404).json({ error: 'Bulunamadı' }));
// Hata yakalayıcı
app.use((err, req, res, next) => {
  console.error('Sunucu hatası:', err);
  res.status(500).json({ error: 'Sunucu hatası' });
});

const server = http.createServer(app);
realtime.attach(server); // /ws

server.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} üzerinde çalışıyor (REST + /ws)`);
});
