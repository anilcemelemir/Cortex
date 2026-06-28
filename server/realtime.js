// =============================================================
//  Realtime (WebSocket) — auth, ses signaling, text, presence
// =============================================================
//  Her client tek bir WS bağlantısı kurar ve ilk mesajda token ile
//  kimlik doğrular. Sonrasında:
//   - Ses kanalı katıl/ayrıl + WebRTC signaling relay (P2P mesh)
//   - Text mesaj gönder → kalıcı sakla → guild üyelerine yay
//   - Ses durumu (mute/cam/screen) ve presence yayını
//
//  Medya ASLA sunucudan geçmez; sadece offer/answer/ice iletilir.
// =============================================================

const { WebSocketServer } = require('ws');
const { db } = require('./db');
const { verifyToken } = require('./auth');
const hub = require('./hub');

const MAX_MESSAGE_LEN = 2000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const HEARTBEAT_MS = 30000; // ölü/hayalet bağlantıları tespit aralığı
const OFFLINE_GRACE_MS = 8000; // bağlantı koptuktan sonra "çevrimdışı" ilan etmeden önce bekleme

// Kısa kopuş/yeniden bağlanmada (ağ blip'i, uygulamayı tepsiden geri açma)
// kullanıcının "çevrimdışı → çevrimiçi" titremesini önlemek için offline
// yayınını geciktiriyoruz. Bu süre içinde geri bağlanırsa hiç offline olmaz.
const pendingOffline = new Map(); // userId -> timeout

function cancelPendingOffline(userId) {
  const t = pendingOffline.get(userId);
  if (t) { clearTimeout(t); pendingOffline.delete(userId); }
}

function schedulePendingOffline(userId, guildIds) {
  cancelPendingOffline(userId);
  const t = setTimeout(() => {
    pendingOffline.delete(userId);
    if (hub.isOnline(userId)) return; // bu arada geri geldi → hâlâ çevrimiçi
    for (const guildId of guildIds) {
      hub.broadcastToGuild(guildId, 'member-presence', { guildId, userId, online: false });
      hub.broadcastToGuild(guildId, 'member-activity', { guildId, userId, activity: null });
    }
  }, OFFLINE_GRACE_MS);
  pendingOffline.set(userId, t);
}

function userPub(userId) {
  const u = db.prepare('SELECT id, username, avatar_color, avatar_image FROM users WHERE id = ?').get(userId);
  return u ? { id: u.id, username: u.username, avatarColor: u.avatar_color, avatarImage: u.avatar_image || null } : null;
}

function isMember(guildId, userId) {
  return !!db.prepare('SELECT 1 FROM guild_members WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

function voiceChannel(channelId) {
  return db.prepare("SELECT * FROM channels WHERE id = ? AND type = 'voice'").get(channelId);
}

function messageChannel(channelId) {
  return db.prepare("SELECT * FROM channels WHERE id = ? AND type IN ('text', 'code')").get(channelId);
}
function cleanFilename(value) {
  const name = String(value || 'dosya').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return (name || 'dosya').slice(0, 120);
}
function cleanMessageAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((a) => ({
    id: String(a.id || '').slice(0, 80),
    name: cleanFilename(a.name),
    size: Math.max(0, Math.min(Number(a.size) || 0, MAX_FILE_BYTES)),
    mimeType: String(a.mimeType || 'application/octet-stream').slice(0, 120),
    storedName: String(a.storedName || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 160),
  })).filter((a) => /^[a-f0-9-]+\.[a-z0-9]{1,16}$/i.test(a.storedName));
}

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat: yanıt vermeyen (ölü / ani kapanmış) bağlantıları temizle.
  // terminate() → ws 'close' olayını tetikler → leaveVoice + presence güncellenir.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) { client.terminate(); continue; }
      client.isAlive = false;
      try { client.ping(); } catch {}
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws) => {
    ws.userId = null;
    ws.authed = false;
    ws.inVoiceChannel = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Kimlik doğrulanmazsa 5sn içinde bağlantıyı kes
    const authTimer = setTimeout(() => { if (!ws.authed) ws.close(); }, 5000);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      // İlk mesaj auth olmalı
      if (!ws.authed) {
        if (msg.type !== 'auth') return;
        const payload = verifyToken(msg.token);
        if (!payload) { hub.send(ws, 'auth-error', { error: 'Geçersiz oturum' }); ws.close(); return; }
        ws.userId = payload.uid;
        ws.user = userPub(payload.uid);
        if (!ws.user) { ws.close(); return; }
        ws.authed = true;
        clearTimeout(authTimer);
        const wasOffline = !hub.isOnline(ws.userId);
        hub.addSocket(ws);
        cancelPendingOffline(ws.userId); // geri geldi → bekleyen offline'ı iptal et
        const guildIds = hub.userGuildIds(ws.userId);
        const onlineByGuild = {};
        const activitiesByGuild = {};
        const voiceByGuild = {};
        const statusByGuild = {};
        for (const guildId of guildIds) {
          onlineByGuild[guildId] = hub.onlineMembersForGuild(guildId);
          activitiesByGuild[guildId] = hub.activitiesForGuild(guildId);
          voiceByGuild[guildId] = hub.voiceStatesForGuild(guildId);
          statusByGuild[guildId] = hub.statusesForGuild(guildId);
          // Sadece gerçekten çevrimdışıyken (ilk soket) çevrimiçi yayınla →
          // ikinci cihaz / hızlı reconnect gereksiz titreme yapmaz.
          if (wasOffline) hub.broadcastToGuild(guildId, 'member-presence', { guildId, userId: ws.userId, online: true });
        }
        hub.send(ws, 'ready', { user: ws.user });
        hub.send(ws, 'presence-sync', { guilds: onlineByGuild, activities: activitiesByGuild, voice: voiceByGuild, statuses: statusByGuild });
        return;
      }

      handle(ws, msg);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!ws.authed) return;
      const guildIds = hub.userGuildIds(ws.userId);
      leaveVoice(ws);
      hub.removeSocket(ws);
      // Başka soketi kalmadıysa hemen çevrimdışı ilan etme; kısa süre bekle
      // (reconnect titremesini önler). Süre içinde dönerse offline hiç olmaz.
      if (!hub.isOnline(ws.userId)) schedulePendingOffline(ws.userId, guildIds);
    });

    ws.on('error', () => {});
  });

  return wss;
}

function handle(ws, msg) {
  switch (msg.type) {
    case 'join-voice':   return joinVoice(ws, msg.channelId);
    case 'leave-voice':  return leaveVoice(ws);
    case 'signal':       return relaySignal(ws, msg);
    case 'voice-state':  return updateVoiceState(ws, msg.state);
    case 'activity-update': return updateActivity(ws, msg.activity);
    case 'status-update':   return updateStatus(ws, msg.status);
    case 'send-message': return sendMessage(ws, msg);
    case 'typing':       return typing(ws, msg.channelId);
    default: break;
  }
}

// --- Ses kanalına katıl ---
function joinVoice(ws, channelId) {
  const ch = voiceChannel(channelId);
  if (!ch) return;
  if (!isMember(ch.guild_id, ws.userId)) return;
  if (ws.inVoiceChannel === channelId) return; // bu soket zaten içeride

  // Bu kullanıcının önceki ses varlığını TAMAMEN temizle: ister bu soket,
  // ister eski/hayalet bir soket (ani kapanış), ister başka kanal olsun.
  // endVoicePresence eski peer'lere 'voice-peer-left' yollar → onlar stale
  // bağlantıyı düşürür ve birazdan gelecek 'voice-peer-joined' ile yeniden kurar.
  // Bu sayede uygulamayı kapatıp açınca aynı kanala yeniden girilebilir.
  endVoicePresence(ws.userId);
  for (const s of hub.socketsForUser(ws.userId)) s.inVoiceChannel = null;

  // Katılmadan ÖNCE oradakileri al (kendimiz hariç) → yeni gelen onlara bağlanır
  const existing = hub.voiceMemberStates(channelId)
    .filter(({ userId }) => userId !== ws.userId)
    .map(({ userId, state }) => ({ userId, user: userPub(userId), state }))
    .filter((p) => p.user);

  hub.voiceJoin(channelId, ws.userId, {});
  ws.inVoiceChannel = channelId;

  // Yeni gelene mevcut listeyi gönder (initiator o olacak)
  hub.send(ws, 'voice-joined', { channelId, peers: existing });

  // Oradakilere yeni peer'i haber ver (onlar non-initiator)
  for (const p of existing) {
    hub.sendToUser(p.userId, 'voice-peer-joined', { channelId, userId: ws.userId, user: ws.user });
  }

  // Tüm guild'e güncel doluluk durumu (sidebar)
  hub.broadcastToGuild(ch.guild_id, 'voice-presence', { channelId, members: hub.voiceMembers(channelId) });
}

// --- Bir kullanıcının ses varlığını (hangi soket olursa olsun) sonlandır ---
function endVoicePresence(userId) {
  const channelId = hub.userVoiceChannel(userId);
  if (!channelId) return;

  const ch = db.prepare('SELECT guild_id FROM channels WHERE id = ?').get(channelId);
  hub.voiceLeave(userId);

  // Kalanlara ayrıldığını bildir
  for (const uid of hub.voiceMembers(channelId)) {
    hub.sendToUser(uid, 'voice-peer-left', { channelId, userId });
  }
  if (ch) {
    hub.broadcastToGuild(ch.guild_id, 'voice-presence', { channelId, members: hub.voiceMembers(channelId) });
  }
}

// --- Ses kanalından ayrıl (soket kapanışı / leave-voice mesajı) ---
function leaveVoice(ws) {
  if (!ws.inVoiceChannel) return;
  ws.inVoiceChannel = null;
  endVoicePresence(ws.userId);
}

// --- WebRTC signaling relay (offer/answer/ice) ---
function relaySignal(ws, msg) {
  if (!msg.targetUserId || !msg.signal) return;
  hub.sendToUser(msg.targetUserId, 'signal', { fromUserId: ws.userId, signal: msg.signal });
}

// --- Ses durumu (mute/cam/screen) ---
function updateVoiceState(ws, state) {
  const channelId = hub.voiceUpdateState(ws.userId, state || {});
  if (!channelId) return;
  const ch = db.prepare('SELECT guild_id FROM channels WHERE id = ?').get(channelId);
  if (ch) {
    hub.broadcastToGuild(ch.guild_id, 'voice-peer-state', { channelId, userId: ws.userId, state: state || {} });
  }
}

// --- Text mesaj gönder ---
function cleanActivity(activity) {
  if (!activity || typeof activity !== 'object') return null;
  const type = String(activity.type || '');
  if (type !== 'playing' && type !== 'listening') return null;
  const name = String(activity.name || '').trim().slice(0, 80);
  if (!name) return null;
  const service = String(activity.service || '').trim().slice(0, 40);
  return { type, name, service: service || null };
}

function updateActivity(ws, activity) {
  const next = cleanActivity(activity);
  if (!hub.setActivity(ws.userId, next)) return;
  for (const guildId of hub.userGuildIds(ws.userId)) {
    hub.broadcastToGuild(guildId, 'member-activity', { guildId, userId: ws.userId, activity: next });
  }
}

// --- Boşta (AFK) durumu ---
function updateStatus(ws, status) {
  if (!hub.setStatus(ws.userId, status)) return;
  const next = hub.getStatus(ws.userId);
  for (const guildId of hub.userGuildIds(ws.userId)) {
    hub.broadcastToGuild(guildId, 'member-status', { guildId, userId: ws.userId, status: next });
  }
}

function sendMessage(ws, msg) {
  const channelId = msg.channelId;
  const rawContent = String(msg.content || '').slice(0, MAX_MESSAGE_LEN);
  const attachments = cleanMessageAttachments(msg.attachments);
  if (!rawContent.trim() && attachments.length === 0) return;

  const ch = messageChannel(channelId);
  if (!ch) return;
  if (!isMember(ch.guild_id, ws.userId)) return;
  const content = ch.type === 'code' ? rawContent.replace(/\s+$/g, '') : rawContent.trim();

  const { newId, now } = require('./db');
  const id = newId();
  const createdAt = now();
  db.prepare('INSERT INTO messages (id, channel_id, user_id, content, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, channelId, ws.userId, content, attachments.length ? JSON.stringify(attachments) : null, createdAt);

  const message = {
    id, channelId, content, attachments, createdAt,
    author: ws.user,
    nonce: msg.nonce || null, // gönderen optimistik UI'yı eşleştirsin
  };
  hub.broadcastToGuild(ch.guild_id, 'message-created', { message });
}

// --- Yazıyor göstergesi ---
function typing(ws, channelId) {
  const ch = messageChannel(channelId);
  if (!ch || !isMember(ch.guild_id, ws.userId)) return;
  hub.broadcastToGuild(ch.guild_id, 'typing', { channelId, userId: ws.userId, username: ws.user.username }, ws.userId);
}

module.exports = { attach };
