// =============================================================
//  REST API â€” sunucular (guild), kanallar, mesaj geÃ§miÅŸi
// =============================================================
//  Realtime olaylar (yeni mesaj, ses presence) WebSocket'ten gider.
//  Burada kalÄ±cÄ± veri okunur/yazÄ±lÄ±r ve deÄŸiÅŸiklikler ilgili guild
//  Ã¼yelerine hub Ã¼zerinden yayÄ±nlanÄ±r.
// =============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, newId, now, genInviteCode, DATA_DIR } = require('./db');
const { requireAuth } = require('./auth');
const hub = require('./hub');

const router = express.Router();
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_FILE_BYTES = 15 * 1024 * 1024;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const GUILD_NAME_RE = /^.{2,40}$/;
const CHANNEL_NAME_RE = /^[\p{L}\p{N}\-_ ]{1,32}$/u;
const CHANNEL_TYPES = new Set(['text', 'voice', 'code']);

// --- Ãœyelik yardÄ±mcÄ±larÄ± ---
function isMember(guildId, userId) {
  return !!db.prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}
function guildOf(channelId) {
  const c = db.prepare('SELECT guild_id FROM channels WHERE id = ?').get(channelId);
  return c ? c.guild_id : null;
}
function userPub(u) {
  return { id: u.id, username: u.username, avatarColor: u.avatar_color, avatarImage: u.avatar_image || null };
}

function cleanImage(value) {
  if (value == null || value === '') return null;
  const image = String(value);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return undefined;
  if (image.length > 700000) return undefined;
  return image;
}
function cleanFilename(value) {
  const name = path.basename(String(value || 'dosya')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return (name || 'dosya').slice(0, 120);
}
function parseAttachments(value) {
  if (!value) return [];
  try {
    const items = JSON.parse(value);
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}
function cleanMessageAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((a) => ({
    id: String(a.id || newId()).slice(0, 80),
    name: cleanFilename(a.name),
    size: Math.max(0, Math.min(Number(a.size) || 0, MAX_FILE_BYTES)),
    mimeType: String(a.mimeType || 'application/octet-stream').slice(0, 120),
    storedName: String(a.storedName || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 160),
  })).filter((a) => /^[a-f0-9-]+\.[a-z0-9]{1,16}$/i.test(a.storedName));
}

router.get('/files/:name/:displayName?', (req, res) => {
  const storedName = String(req.params.name || '');
  if (!/^[a-f0-9-]+\.[a-z0-9]{1,16}$/i.test(storedName)) return res.sendStatus(404);
  const file = path.resolve(UPLOAD_DIR, storedName);
  if (!file.startsWith(path.resolve(UPLOAD_DIR) + path.sep) || !fs.existsSync(file)) return res.sendStatus(404);
  res.download(file, cleanFilename(req.params.displayName || storedName));
});

router.use(requireAuth);

// Bir guild'i Ã¼ye listesi + kanallarÄ±yla dÃ¶ndÃ¼r
function guildPayload(guildId) {
  const g = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
  if (!g) return null;
  const channels = db.prepare(`
    SELECT id, name, type, position FROM channels
    WHERE guild_id = ?
    ORDER BY CASE type WHEN 'text' THEN 0 WHEN 'code' THEN 1 WHEN 'voice' THEN 2 ELSE 3 END, position, created_at`).all(guildId);
  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar_color, u.avatar_image, m.role
    FROM guild_members m JOIN users u ON u.id = m.user_id
    WHERE m.guild_id = ?`).all(guildId)
    .map((u) => ({ id: u.id, username: u.username, avatarColor: u.avatar_color, avatarImage: u.avatar_image || null, role: u.role }));
  return {
    id: g.id, name: g.name, ownerId: g.owner_id, inviteCode: g.invite_code, iconImage: g.icon_image || null,
    channels, members,
  };
}

// =============================================================
//  Guild (sunucu) iÅŸlemleri
// =============================================================

// Ãœye olunan tÃ¼m sunucular
router.get('/guilds', (req, res) => {
  const guilds = db.prepare(`
    SELECT g.* FROM guilds g
    JOIN guild_members m ON m.guild_id = g.id
    WHERE m.user_id = ?
    ORDER BY g.created_at`).all(req.user.id);
  res.json({ guilds: guilds.map((g) => guildPayload(g.id)) });
});

// Yeni sunucu oluÅŸtur (+ varsayÄ±lan kanallar)
router.post('/guilds', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!GUILD_NAME_RE.test(name)) return res.status(400).json({ error: 'Sunucu adÄ± 2-40 karakter olmalÄ±' });

  const gid = newId();
  const t = now();
  const tx = db.prepare; // sadece okunabilirlik
  db.prepare('INSERT INTO guilds (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(gid, name, req.user.id, genInviteCode(), t);
  db.prepare('INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(gid, req.user.id, 'owner', t);
  // VarsayÄ±lan kanallar: bir text + bir ses
  db.prepare('INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), gid, 'genel', 'text', 0, t);
  db.prepare('INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), gid, 'Sohbet', 'voice', 0, t + 1);

  res.json({ guild: guildPayload(gid) });
});

// Davet koduyla sunucuya katÄ±l
router.post('/guilds/join', (req, res) => {
  const code = String(req.body.inviteCode || '').trim();
  const g = db.prepare('SELECT * FROM guilds WHERE invite_code = ?').get(code);
  if (!g) return res.status(404).json({ error: 'GeÃ§ersiz davet kodu' });

  if (!isMember(g.id, req.user.id)) {
    db.prepare('INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(g.id, req.user.id, 'member', now());
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    // DiÄŸer Ã¼yelere yeni Ã¼yeyi haber ver
    hub.broadcastToGuild(g.id, 'member-joined', { guildId: g.id, member: { ...userPub(me), role: 'member' } }, req.user.id);
    hub.broadcastToGuild(g.id, 'member-presence', { guildId: g.id, userId: req.user.id, online: hub.isOnline(req.user.id) });
  }
  res.json({ guild: guildPayload(g.id) });
});

// Tek bir guild detayÄ±
router.get('/guilds/:id', (req, res) => {
  if (!isMember(req.params.id, req.user.id)) return res.status(403).json({ error: 'Ãœye deÄŸilsin' });
  const p = guildPayload(req.params.id);
  if (!p) return res.status(404).json({ error: 'Sunucu bulunamadÄ±' });
  res.json({ guild: p });
});

// Sunucudan ayrÄ±l
router.patch('/guilds/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM guilds WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Sunucu bulunamadÃ„Â±' });
  if (g.owner_id !== req.user.id) return res.status(403).json({ error: 'Sadece sunucu sahibi dÃƒÂ¼zenleyebilir' });

  const name = String(req.body.name || '').trim();
  const iconImage = cleanImage(req.body.iconImage);
  if (!GUILD_NAME_RE.test(name)) return res.status(400).json({ error: 'Sunucu adÃ„Â± 2-40 karakter olmalÃ„Â±' });
  if (iconImage === undefined) return res.status(400).json({ error: 'GeÃ§ersiz sunucu fotoÄŸrafÄ±' });

  db.prepare('UPDATE guilds SET name = ?, icon_image = ? WHERE id = ?').run(name, iconImage, g.id);
  hub.broadcastToGuild(g.id, 'guild-updated', { guildId: g.id, name, iconImage });
  res.json({ guild: guildPayload(g.id) });
});

router.post('/guilds/:id/leave', (req, res) => {
  const g = db.prepare('SELECT * FROM guilds WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Sunucu bulunamadÄ±' });
  if (g.owner_id === req.user.id) return res.status(400).json({ error: 'Sahibi ayrÄ±lamaz; sunucuyu silebilirsin' });
  db.prepare('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?').run(g.id, req.user.id);
  hub.broadcastToGuild(g.id, 'member-left', { guildId: g.id, userId: req.user.id });
  res.json({ ok: true });
});

// Sunucuyu sil (sadece sahip)
router.delete('/guilds/:id', (req, res) => {
  const g = db.prepare('SELECT * FROM guilds WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Sunucu bulunamadÄ±' });
  if (g.owner_id !== req.user.id) return res.status(403).json({ error: 'Sadece sahibi silebilir' });

  hub.broadcastToGuild(g.id, 'guild-deleted', { guildId: g.id });
  const chans = db.prepare('SELECT id FROM channels WHERE guild_id = ?').all(g.id).map((c) => c.id);
  for (const cid of chans) db.prepare('DELETE FROM messages WHERE channel_id = ?').run(cid);
  db.prepare('DELETE FROM channels WHERE guild_id = ?').run(g.id);
  db.prepare('DELETE FROM guild_members WHERE guild_id = ?').run(g.id);
  db.prepare('DELETE FROM guilds WHERE id = ?').run(g.id);
  res.json({ ok: true });
});

// =============================================================
//  Kanal iÅŸlemleri
// =============================================================

// Kanal oluÅŸtur (sadece sahip)
router.post('/guilds/:id/channels', (req, res) => {
  const guildId = req.params.id;
  if (!isMember(guildId, req.user.id)) return res.status(403).json({ error: 'Ãœye deÄŸilsin' });
  const owner = db.prepare('SELECT owner_id FROM guilds WHERE id = ?').get(guildId);
  if (!owner || owner.owner_id !== req.user.id) return res.status(403).json({ error: 'Sadece sunucu sahibi kanal oluÅŸturabilir' });

  const name = String(req.body.name || '').trim();
  const type = CHANNEL_TYPES.has(req.body.type) ? req.body.type : 'text';
  if (!CHANNEL_NAME_RE.test(name)) return res.status(400).json({ error: 'Kanal adÄ± 1-32 karakter olmalÄ±' });

  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM channels WHERE guild_id = ? AND type = ?').get(guildId, type).m;
  const ch = { id: newId(), guild_id: guildId, name, type, position: maxPos + 1, created_at: now() };
  db.prepare('INSERT INTO channels (id, guild_id, name, type, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ch.id, ch.guild_id, ch.name, ch.type, ch.position, ch.created_at);

  const payload = { id: ch.id, name: ch.name, type: ch.type, position: ch.position };
  hub.broadcastToGuild(guildId, 'channel-created', { guildId, channel: payload });
  res.json({ channel: payload });
});

// Kanal sil (sadece sahip)
router.delete('/channels/:id', (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Kanal bulunamadÄ±' });
  const g = db.prepare('SELECT owner_id FROM guilds WHERE id = ?').get(ch.guild_id);
  if (!g || g.owner_id !== req.user.id) return res.status(403).json({ error: 'Sadece sunucu sahibi silebilir' });

  db.prepare('DELETE FROM messages WHERE channel_id = ?').run(ch.id);
  db.prepare('DELETE FROM channels WHERE id = ?').run(ch.id);
  hub.broadcastToGuild(ch.guild_id, 'channel-deleted', { guildId: ch.guild_id, channelId: ch.id });
  res.json({ ok: true });
});

// Kanal adÄ±nÄ± deÄŸiÅŸtir (sadece sahip)
router.patch('/channels/:id', (req, res) => {
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Kanal bulunamadÄ±' });
  const g = db.prepare('SELECT owner_id FROM guilds WHERE id = ?').get(ch.guild_id);
  if (!g || g.owner_id !== req.user.id) return res.status(403).json({ error: 'Sadece sunucu sahibi dÃ¼zenleyebilir' });

  const name = String(req.body.name || '').trim();
  if (!CHANNEL_NAME_RE.test(name)) return res.status(400).json({ error: 'Kanal adÄ± 1-32 karakter olmalÄ±' });
  db.prepare('UPDATE channels SET name = ? WHERE id = ?').run(name, ch.id);
  hub.broadcastToGuild(ch.guild_id, 'channel-updated', { guildId: ch.guild_id, channelId: ch.id, name });
  res.json({ ok: true });
});

router.post('/channels/:id/files', (req, res) => {
  const ch = db.prepare('SELECT id, guild_id, type FROM channels WHERE id = ?').get(req.params.id);
  if (!ch || !isMember(ch.guild_id, req.user.id)) return res.status(403).json({ error: 'EriÅŸim yok' });
  if (ch.type !== 'text' && ch.type !== 'code') return res.status(400).json({ error: 'Bu kanala dosya yÃ¼klenemez' });

  const originalName = cleanFilename(req.body.name);
  const mimeType = String(req.body.mimeType || 'application/octet-stream').slice(0, 120);
  const rawData = String(req.body.data || '');
  const base64 = rawData.includes(',') ? rawData.split(',').pop() : rawData;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) return res.status(400).json({ error: 'Dosya okunamadÄ±' });

  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) return res.status(400).json({ error: 'BoÅŸ dosya yÃ¼klenemez' });
  if (buf.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'Dosya en fazla 15 MB olabilir' });

  const ext = (path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 17) || '.bin');
  const storedName = `${newId()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf);
  res.json({
    attachment: {
      id: newId(),
      name: originalName,
      size: buf.length,
      mimeType,
      storedName,
    },
  });
});

// =============================================================
//  Mesaj geÃ§miÅŸi (text kanal)
// =============================================================
router.get('/channels/:id/messages', (req, res) => {
  const channelId = req.params.id;
  const guildId = guildOf(channelId);
  if (!guildId || !isMember(guildId, req.user.id)) return res.status(403).json({ error: 'EriÅŸim yok' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before, 10) : null;

  const rows = before
    ? db.prepare(`SELECT m.id, m.content, m.attachments, m.created_at, u.id AS uid, u.username, u.avatar_color, u.avatar_image
                  FROM messages m JOIN users u ON u.id = m.user_id
                  WHERE m.channel_id = ? AND m.created_at < ?
                  ORDER BY m.created_at DESC LIMIT ?`).all(channelId, before, limit)
    : db.prepare(`SELECT m.id, m.content, m.attachments, m.created_at, u.id AS uid, u.username, u.avatar_color, u.avatar_image
                  FROM messages m JOIN users u ON u.id = m.user_id
                  WHERE m.channel_id = ?
                  ORDER BY m.created_at DESC LIMIT ?`).all(channelId, limit);

  const messages = rows.reverse().map((m) => ({
    id: m.id, channelId, content: m.content, createdAt: m.created_at,
    attachments: parseAttachments(m.attachments),
    author: { id: m.uid, username: m.username, avatarColor: m.avatar_color, avatarImage: m.avatar_image || null },
  }));
  res.json({ messages });
});

module.exports = { router, guildPayload };
