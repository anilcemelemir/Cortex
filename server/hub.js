// =============================================================
//  Bağlantı Merkezi (Hub) — presence + broadcast + ses odaları
// =============================================================
//  Kim çevrimiçi, kim hangi ses kanalında, ve guild üyelerine
//  realtime olay yayını. REST (api.js) ve WebSocket (realtime.js)
//  bunu ortak kullanır → döngüsel bağımlılık olmaz.
//
//  Ses kimliği = userId. Bir kullanıcı aynı anda tek ses kanalında
//  olabilir (Discord davranışı). peerId olarak doğrudan userId
//  kullanılır → karşı tarafın adını göstermek kolay.
// =============================================================

const { db } = require('./db');

// userId -> Set<ws>   (bir kullanıcı birden çok cihazdan bağlanabilir)
const userSockets = new Map();

// channelId -> Map<userId, { state }>   (ses kanalındakiler)
const voiceRooms = new Map();
// userId -> channelId   (kullanıcı şu an hangi ses kanalında)
const userVoice = new Map();
const userActivities = new Map();
// userId -> 'idle'   (yalnızca boşta olanlar tutulur; yoksa 'online' kabul edilir)
const userStatus = new Map();

function send(ws, type, payload = {}) {
  if (ws && ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function addSocket(ws) {
  if (!userSockets.has(ws.userId)) userSockets.set(ws.userId, new Set());
  userSockets.get(ws.userId).add(ws);
}

function removeSocket(ws) {
  const set = userSockets.get(ws.userId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      userSockets.delete(ws.userId);
      userActivities.delete(ws.userId);
      userStatus.delete(ws.userId);
    }
  }
}

function isOnline(userId) {
  return userSockets.has(userId);
}

function sendToUser(userId, type, payload) {
  const set = userSockets.get(userId);
  if (set) for (const ws of set) send(ws, type, payload);
}

// Bir kullanıcının açık tüm soketleri (çok cihaz / yeniden bağlanma durumları)
function socketsForUser(userId) {
  const set = userSockets.get(userId);
  return set ? [...set] : [];
}

function userGuildIds(userId) {
  return db.prepare('SELECT guild_id FROM guild_members WHERE user_id = ?')
    .all(userId).map((r) => r.guild_id);
}

function onlineMembersForGuild(guildId) {
  return guildMemberIds(guildId).filter((uid) => isOnline(uid));
}

function activitiesForGuild(guildId) {
  const out = {};
  for (const uid of onlineMembersForGuild(guildId)) {
    const activity = userActivities.get(uid);
    if (activity) out[uid] = activity;
  }
  return out;
}

// --- Boşta (AFK) durumu ---
function getStatus(userId) {
  return userStatus.get(userId) || 'online';
}

function setStatus(userId, status) {
  const next = status === 'idle' ? 'idle' : 'online';
  const current = getStatus(userId);
  if (current === next) return false;
  if (next === 'idle') userStatus.set(userId, 'idle');
  else userStatus.delete(userId);
  return true;
}

// Bir guild'in çevrimiçi + boşta üyeleri: { userId: 'idle' }
function statusesForGuild(guildId) {
  const out = {};
  for (const uid of onlineMembersForGuild(guildId)) {
    if (getStatus(uid) === 'idle') out[uid] = 'idle';
  }
  return out;
}

function setActivity(userId, activity) {
  const current = userActivities.get(userId) || null;
  const next = activity || null;
  const norm = (a) => a ? { type: a.type, name: a.name, service: a.service || null } : null;
  if (JSON.stringify(norm(current)) === JSON.stringify(norm(next))) return false;
  if (next) userActivities.set(userId, { ...next, updatedAt: Date.now() });
  else userActivities.delete(userId);
  return true;
}

function guildMemberIds(guildId) {
  return db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?')
    .all(guildId).map((r) => r.user_id);
}

// Bir guild'in çevrimiçi tüm üyelerine yayın yap
function broadcastToGuild(guildId, type, payload, exceptUserId = null) {
  for (const uid of guildMemberIds(guildId)) {
    if (uid === exceptUserId) continue;
    sendToUser(uid, type, payload);
  }
}

// =============================================================
//  Ses kanalı (voice) presence
// =============================================================
function voiceMembers(channelId) {
  const room = voiceRooms.get(channelId);
  return room ? [...room.keys()] : [];
}

function voiceMemberStates(channelId) {
  const room = voiceRooms.get(channelId);
  if (!room) return [];
  return [...room.entries()].map(([userId, v]) => ({ userId, state: v.state || {} }));
}

function userVoiceChannel(userId) {
  return userVoice.get(userId) || null;
}

function voiceJoin(channelId, userId, state = {}) {
  // Önce eski kanaldan çıkar (tek kanal kuralı)
  const prev = userVoice.get(userId);
  if (prev && prev !== channelId) voiceLeave(userId);

  if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Map());
  voiceRooms.get(channelId).set(userId, { state });
  userVoice.set(userId, channelId);
}

function voiceUpdateState(userId, state) {
  const channelId = userVoice.get(userId);
  if (!channelId) return null;
  const room = voiceRooms.get(channelId);
  if (room && room.has(userId)) room.get(userId).state = state;
  return channelId;
}

function voiceLeave(userId) {
  const channelId = userVoice.get(userId);
  if (!channelId) return null;
  const room = voiceRooms.get(channelId);
  if (room) {
    room.delete(userId);
    if (room.size === 0) voiceRooms.delete(channelId);
  }
  userVoice.delete(userId);
  return channelId;
}

// Bir guild'deki tüm ses kanallarının doluluk durumu (sidebar için)
function voicePresenceForGuild(guildId) {
  const channels = db.prepare("SELECT id FROM channels WHERE guild_id = ? AND type = 'voice'").all(guildId);
  const out = {};
  for (const c of channels) out[c.id] = voiceMembers(c.id);
  return out;
}

// Bir guild'in dolu ses kanalları + içindekilerin durumları (ilk senkron için)
// { channelId: [{ userId, state }] } — sadece içinde kimse olan kanallar.
function voiceStatesForGuild(guildId) {
  const channels = db.prepare("SELECT id FROM channels WHERE guild_id = ? AND type = 'voice'").all(guildId);
  const out = {};
  for (const c of channels) {
    const states = voiceMemberStates(c.id);
    if (states.length) out[c.id] = states;
  }
  return out;
}

module.exports = {
  send,
  addSocket,
  removeSocket,
  isOnline,
  sendToUser,
  socketsForUser,
  guildMemberIds,
  userGuildIds,
  onlineMembersForGuild,
  activitiesForGuild,
  setActivity,
  getStatus,
  setStatus,
  statusesForGuild,
  broadcastToGuild,
  voiceMembers,
  voiceMemberStates,
  userVoiceChannel,
  voiceJoin,
  voiceUpdateState,
  voiceLeave,
  voicePresenceForGuild,
  voiceStatesForGuild,
};
