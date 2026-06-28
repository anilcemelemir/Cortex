// =============================================================
//  Kimlik Doğrulama (Auth)
// =============================================================
//  Kullanıcı adı + şifre. Şifreler bcrypt ile hashlenir.
//  Oturum için JWT verilir; client token'ı saklar ve hem REST
//  hem WebSocket isteklerinde gönderir.
// =============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, newId, now, randomColor, DATA_DIR } = require('./db');
const hub = require('./hub');

// --- JWT secret (env > kalıcı dosya > üret) ---
// Restart'ta token'lar geçerli kalsın diye secret'ı dosyada saklarız.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, 'jwt.secret');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    const s = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();
const TOKEN_TTL = '30d';

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

// Express middleware: Authorization: Bearer <token>
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Oturum gerekli' });
  req.user = { id: payload.uid, username: payload.username };
  next();
}

// Şifre dışı güvenli kullanıcı objesi
function publicUser(u) {
  return { id: u.id, username: u.username, avatarColor: u.avatar_color, avatarImage: u.avatar_image || null };
}

function cleanImage(value) {
  if (value == null || value === '') return null;
  const image = String(value);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return undefined;
  if (image.length > 700000) return undefined;
  return image;
}

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,20}$/;

// --- Kayıt ---
router.post('/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ . -)' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (exists) return res.status(409).json({ error: 'Bu kullanıcı adı alınmış' });

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: newId(),
    username,
    password_hash: hash,
    avatar_color: randomColor(),
    created_at: now(),
  };
  db.prepare(`INSERT INTO users (id, username, password_hash, avatar_color, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(user.id, user.username, user.password_hash, user.avatar_color, user.created_at);

  res.json({ token: signToken(user), user: publicUser(user) });
});

// --- Giriş ---
router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı' });

  res.json({ token: signToken(user), user: publicUser(user) });
});

// --- Mevcut oturum bilgisi ---
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  res.json({ user: publicUser(user) });
});

router.patch('/me', requireAuth, (req, res) => {
  const username = String(req.body.username || '').trim();
  const avatarColor = String(req.body.avatarColor || '').trim();
  const avatarImage = cleanImage(req.body.avatarImage);

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'KullanÄ±cÄ± adÄ± 3-20 karakter olmalÄ± (harf, rakam, _ . -)' });
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(avatarColor)) {
    return res.status(400).json({ error: 'GeÃ§ersiz avatar rengi' });
  }

  if (avatarImage === undefined) return res.status(400).json({ error: 'GeÃ§ersiz profil fotoÄŸrafÄ±' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?').get(username, req.user.id);
  if (exists) return res.status(409).json({ error: 'Bu kullanÄ±cÄ± adÄ± alÄ±nmÄ±ÅŸ' });

  db.prepare('UPDATE users SET username = ?, avatar_color = ?, avatar_image = ? WHERE id = ?').run(username, avatarColor, avatarImage, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const payload = publicUser(user);
  for (const guildId of hub.userGuildIds(user.id)) {
    hub.broadcastToGuild(guildId, 'member-updated', { guildId, member: payload });
  }
  res.json({ token: signToken(user), user: payload });
});

module.exports = { router, requireAuth, verifyToken, publicUser };
