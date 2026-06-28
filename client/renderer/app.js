// =============================================================
//  Ana Uygulama (UI + Orkestrasyon)
// =============================================================

const media = new MediaManager();
const mesh = new VoiceMesh(media);

const appState = (window.appState = {
  me: null,
  guilds: new Map(),          // guildId -> guild
  currentGuildId: null,
  currentTextChannelId: null,
  view: 'welcome',            // 'welcome' | 'text' | 'voice'
  voice: {
    channelId: null, guildId: null, connected: false,
    muted: false, speakerMuted: false, camOn: false, screenOn: false,
    pings: new Map(),         // userId -> ms
    audioEls: new Map(),      // userId -> audio element
  },
  voicePresence: new Map(),   // channelId -> [userId]
  voiceStates: new Map(),     // userId -> { muted, camOn, screenOn }
  onlineUsers: new Set(),     // userId
  activities: new Map(),      // userId -> { type, name, service }
  messages: new Map(),        // channelId -> [msg]
  mode: window.Store.get('voiceMode'),
  pttKey: window.Store.get('pttKey'),
  pttActive: false,
});

const userCache = new Map();  // userId -> { id, username, avatarColor, avatarImage }
const AVATAR_PLACEHOLDER_SRC = '../../assets/PP_Placeholder.png';
let profileDraftImage = null;
let serverDraftIcon = null;
let pendingAttachments = [];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const icon = (name, cls = 'app-icon') => window.Icons ? window.Icons.svg(name, cls) : '';
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) { return (name || '?').trim().slice(0, 2).toUpperCase(); }
function cacheUser(u) { if (u && u.id) userCache.set(u.id, { id: u.id, username: u.username, avatarColor: u.avatarColor, avatarImage: u.avatarImage || null }); return u; }
function getUser(id) { return userCache.get(id) || { id, username: 'Bilinmeyen', avatarColor: '#747f8d' }; }
function avatarHtml(className, user) {
  const color = user?.avatarColor || '#747f8d';
  const src = user?.avatarImage || AVATAR_PLACEHOLDER_SRC;
  return `<span class="${className}" style="background:${color}"><img src="${src}" alt="" draggable="false" /></span>`;
}
function renderAvatar(node, user) {
  if (!node) return;
  node.style.background = user?.avatarColor || '#747f8d';
  node.innerHTML = `<img src="${user?.avatarImage || AVATAR_PLACEHOLDER_SRC}" alt="" draggable="false" />`;
}
function imageFileToDataUrl(file, size = 320) {
  if (!file) return Promise.reject(new Error('Fotoğraf seçilmedi'));
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return Promise.reject(new Error('PNG, JPG veya WebP seçebilirsin'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Fotoğraf okunamadı'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Fotoğraf yüklenemedi'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const crop = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - crop) / 2;
        const sy = (img.naturalHeight - crop) / 2;
        ctx.drawImage(img, sx, sy, crop, crop, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        if (dataUrl.length > 700000) reject(new Error('Fotoğraf çok büyük'));
        else resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function updateProfilePreview() {
  renderAvatar($('profile-preview'), {
    ...appState.me,
    avatarColor: $('profile-color')?.value || appState.me?.avatarColor,
    avatarImage: profileDraftImage,
  });
}
function renderServerImagePreview() {
  const g = selectedGuild();
  const node = $('server-image-preview');
  if (!node || !g) return;
  if (serverDraftIcon) {
    node.style.background = 'var(--bg-sidebar)';
    node.innerHTML = `<img src="${serverDraftIcon}" alt="" draggable="false" />`;
  } else {
    node.style.background = colorFromString(g.id);
    node.textContent = initials($('server-settings-name')?.value || g.name);
  }
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Dosya okunamadı'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}
function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
function highlightCode(raw) {
  const source = String(raw || '');
  const tokenRe = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\b(?:async|await|break|case|catch|class|const|continue|default|else|export|false|for|from|function|if|import|let|new|null|return|switch|true|try|undefined|var|while)\b|\b\d+(?:\.\d+)?\b)/g;
  let out = '';
  let last = 0;
  for (const match of source.matchAll(tokenRe)) {
    const token = match[0];
    out += escapeHtml(source.slice(last, match.index));
    const cls = token.startsWith('//') || token.startsWith('/*')
      ? 'tok-comment'
      : (/^["'`]/.test(token) ? 'tok-string' : (/^\d/.test(token) ? 'tok-number' : 'tok-keyword'));
    out += `<span class="${cls}">${escapeHtml(token)}</span>`;
    last = match.index + token.length;
  }
  return out + escapeHtml(source.slice(last));
}
function renderAttachments(attachments = []) {
  if (!attachments.length) return '';
  return `<div class="msg-attachments">${attachments.map((a) => `
    <a class="msg-attachment" href="${window.Api.fileUrl(a)}" download="${escapeHtml(a.name)}" target="_blank" rel="noreferrer">
      <span class="file-ico">${icon('file')}</span>
      <span class="file-info"><span class="file-name">${escapeHtml(a.name)}</span><span class="file-size">${formatBytes(a.size)}</span></span>
    </a>`).join('')}</div>`;
}
function renderAttachmentTray() {
  const tray = $('attachment-tray');
  if (!tray) return;
  tray.classList.toggle('hidden', pendingAttachments.length === 0);
  tray.innerHTML = pendingAttachments.map((a) => `
    <div class="attachment-chip" data-attachment-id="${escapeHtml(a.id)}">
      <span class="file-ico">${icon('file')}</span>
      <span class="file-name">${escapeHtml(a.name)}</span>
      <button class="chip-remove" title="Eki kaldır">${icon('close')}</button>
    </div>`).join('');
}
function playSound(name) {
  window.CortexSounds?.play(name);
}
function activityText(activity) {
  if (!activity?.name) return '';
  if (activity.type === 'listening') return `${activity.name} dinliyor`;
  if (activity.type === 'playing') return `${activity.name} oynuyor`;
  return '';
}
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function outputVolume() {
  return clampNumber(window.Store.get('outputVolume'), 0, 2, 1);
}
function applyOutputVolume() {
  const volume = outputVolume();
  for (const audio of appState.voice.audioEls.values()) audio.volume = volume;
}
function syncVoiceTuneLabels() {
  const gain = clampNumber(window.Store.get('inputGainDb'), -20, 20, 0);
  const threshold = clampNumber(window.Store.get('vadThresholdDb'), -80, -20, -55);
  const out = Math.round(outputVolume() * 100);
  if ($('range-input-gain')) $('range-input-gain').value = String(gain);
  if ($('input-gain-label')) $('input-gain-label').textContent = `${gain > 0 ? '+' : ''}${gain} dB`;
  if ($('range-vad-threshold')) $('range-vad-threshold').value = String(threshold);
  if ($('vad-threshold-label')) $('vad-threshold-label').textContent = `${threshold} dB`;
  if ($('range-output-volume')) $('range-output-volume').value = String(out);
  if ($('output-volume-label')) $('output-volume-label').textContent = `${out}%`;
}
let activityTimer = null;
let lastActivityKey = '';
async function publishDesktopActivity(force = false) {
  if (!window.activity?.detect || !window.gateway) return;
  if (!window.Store.get('activityEnabled')) {
    if (lastActivityKey !== 'null' || force) {
      lastActivityKey = 'null';
      if (appState.me?.id) appState.activities.delete(appState.me.id);
      renderMemberSidebar();
      window.gateway.send({ type: 'activity-update', activity: null });
    }
    return;
  }
  try {
    const activity = await window.activity.detect();
    const key = JSON.stringify(activity || null);
    if (!force && key === lastActivityKey) return;
    lastActivityKey = key;
    if (appState.me?.id) {
      if (activity) appState.activities.set(appState.me.id, activity);
      else appState.activities.delete(appState.me.id);
      renderMemberSidebar();
    }
    window.gateway.send({ type: 'activity-update', activity });
  } catch (e) {
    console.warn('Aktivite algılanamadı', e);
  }
}
function startActivityReporter() {
  if (activityTimer) clearInterval(activityTimer);
  publishDesktopActivity(true);
  activityTimer = setInterval(() => publishDesktopActivity(false), 15000);
}
function updateCachedMember(member) {
  if (!member || !member.id) return;
  cacheUser(member);
  for (const g of appState.guilds.values()) {
    const existing = g.members?.find((m) => m.id === member.id);
    if (existing) Object.assign(existing, member);
  }
  for (const list of appState.messages.values()) {
    for (const msg of list) {
      if (msg.author?.id === member.id) msg.author = { ...msg.author, ...member };
    }
  }
}
function selectedGuild() {
  return appState.guilds.get(appState.currentGuildId) || null;
}
function channelIcon(type) {
  if (type === 'voice') return 'speaker';
  if (type === 'code') return 'code';
  return 'hash';
}
function currentMessageChannel() {
  const g = selectedGuild();
  return g?.channels.find((c) => c.id === appState.currentTextChannelId) || null;
}

// =============================================================
//  Önyükleme
// =============================================================
$('auth-server').value = window.Store.get('serverUrl');

(async function boot() {
  const token = window.Store.get('token');
  if (token) {
    try {
      const { user } = await window.Api.me();
      enterApp(user);
      return;
    } catch (e) { window.Store.clearAuth(); }
  }
  showAuth();
})();

// =============================================================
//  Giriş / Kayıt
// =============================================================
let authMode = 'login';
function showAuth() { $('auth-screen').classList.remove('hidden'); $('app').classList.add('hidden'); }

document.querySelectorAll('.auth-tab').forEach((t) => t.addEventListener('click', () => {
  authMode = t.dataset.mode;
  document.querySelectorAll('.auth-tab').forEach((x) => x.classList.toggle('active', x === t));
  $('auth-title').textContent = authMode === 'login' ? 'Tekrar hoş geldin!' : 'Hesap oluştur';
  $('auth-sub').textContent = authMode === 'login' ? 'Hesabınla giriş yap' : 'Birkaç saniyede hazır';
  $('auth-submit').textContent = authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol';
  $('auth-error').textContent = '';
  $('auth-password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
}));

$('auth-submit').addEventListener('click', doAuth);
$('auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
$('auth-username').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('auth-password').focus(); });

async function doAuth() {
  const username = $('auth-username').value.trim();
  const password = $('auth-password').value;
  const server = $('auth-server').value.trim() || window.CONFIG.defaultServer;
  window.Store.set('serverUrl', server);
  $('auth-error').textContent = '';
  $('auth-submit').disabled = true;
  try {
    const res = authMode === 'login' ? await window.Api.login(username, password) : await window.Api.register(username, password);
    window.Store.set('token', res.token);
    enterApp(res.user);
  } catch (e) {
    $('auth-error').textContent = e.message;
  } finally {
    $('auth-submit').disabled = false;
  }
}

// =============================================================
//  Uygulamaya giriş
// =============================================================
async function enterApp(user) {
  appState.me = cacheUser(user);
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');

  // Kullanıcı paneli
  $('up-name').textContent = user.username;
  renderAvatar($('up-avatar'), user);

  applyModeUI();
  wireGateway();
  window.gateway.connect();
  startActivityReporter();

  await loadGuilds();
  showWelcome();
}

async function loadGuilds() {
  try {
    const { guilds } = await window.Api.listGuilds();
    appState.guilds.clear();
    for (const g of guilds) { indexGuild(g); }
    renderGuildRail();
  } catch (e) { console.error('Sunucular yüklenemedi', e); }
}

function indexGuild(g) {
  appState.guilds.set(g.id, g);
  for (const m of g.members || []) cacheUser({ id: m.id, username: m.username, avatarColor: m.avatarColor, avatarImage: m.avatarImage || null });
}

// =============================================================
//  Sunucu çubuğu (guild rail)
// =============================================================
function renderGuildRail() {
  const list = $('guild-list');
  list.innerHTML = '';
  for (const g of appState.guilds.values()) {
    const b = el('button', 'guild-btn', g.iconImage ? `<img class="guild-img" src="${g.iconImage}" alt="" draggable="false" />` : initials(g.name));
    b.title = g.name;
    b.style.background = g.iconImage ? 'var(--bg-sidebar)' : colorFromString(g.id);
    if (g.id === appState.currentGuildId) b.classList.add('active');
    b.addEventListener('click', () => selectGuild(g.id));
    list.appendChild(b);
  }
}

function colorFromString(s) {
  const colors = ['#5865f2', '#23a55a', '#f0b232', '#eb459e', '#e67e22', '#3498db', '#9b59b6'];
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

$('btn-home').addEventListener('click', () => { appState.currentGuildId = null; showWelcome(); updateRailActive(); });
function updateRailActive() {
  $('btn-home').classList.toggle('active', !appState.currentGuildId);
  document.querySelectorAll('#guild-list .guild-btn').forEach((b) => b.classList.toggle('active', b.title === appState.guilds.get(appState.currentGuildId)?.name));
  renderGuildRail();
}

function showWelcome() {
  appState.view = 'welcome';
  appState.currentTextChannelId = null;
  $('guild-header-name').textContent = 'Ana Sayfa';
  $('btn-guild-menu').classList.add('hidden');
  $('channel-list').innerHTML = '';
  $('member-sidebar').classList.add('hidden');
  $('member-list').innerHTML = '';
  swapMain('welcome-view');
}

// =============================================================
//  Sunucu seçimi + kanal listesi
// =============================================================
function selectGuild(guildId) {
  appState.currentGuildId = guildId;
  const g = appState.guilds.get(guildId);
  if (!g) return;
  $('guild-header-name').textContent = g.name;
  $('btn-guild-menu').classList.remove('hidden');
  renderGuildRail();
  $('btn-home').classList.remove('active');
  renderChannelList();
  renderMemberSidebar();

  // İlk text/kod kanalını aç
  const firstText = g.channels.find((c) => c.type === 'text' || c.type === 'code');
  if (firstText) selectTextChannel(firstText.id);
  else swapMain('welcome-view');
}

function renderChannelList() {
  const g = appState.guilds.get(appState.currentGuildId);
  if (!g) return;
  const list = $('channel-list');
  list.innerHTML = '';

  const texts = g.channels.filter((c) => c.type === 'text');
  const codes = g.channels.filter((c) => c.type === 'code');
  const voices = g.channels.filter((c) => c.type === 'voice');

  if (texts.length) list.appendChild(el('div', 'channel-cat', 'Text Kanalları'));
  for (const c of texts) list.appendChild(textChannelEl(c));

  if (codes.length) list.appendChild(el('div', 'channel-cat', 'Kod Kanalları'));
  for (const c of codes) list.appendChild(textChannelEl(c));

  if (voices.length) list.appendChild(el('div', 'channel-cat', 'Ses Kanalları'));
  for (const c of voices) {
    list.appendChild(voiceChannelEl(c));
    list.appendChild(voiceOccupantsEl(c.id));
  }
}

function textChannelEl(c) {
  const item = el('div', 'channel-item');
  if (appState.view === 'text' && appState.currentTextChannelId === c.id) item.classList.add('active');
  item.innerHTML = `<span class="ci-icon">${icon(channelIcon(c.type))}</span><span class="ci-name">${escapeHtml(c.name)}</span>`;
  item.addEventListener('click', () => selectTextChannel(c.id));
  return item;
}

function voiceChannelEl(c) {
  const members = appState.voicePresence.get(c.id) || [];
  const item = el('div', 'channel-item');
  if (appState.view === 'voice' && appState.voice.channelId === c.id) item.classList.add('active');
  item.innerHTML = `<span class="ci-icon">${icon('speaker')}</span><span class="ci-name">${escapeHtml(c.name)}</span>` +
    (members.length ? `<span class="ci-count">${members.length}</span>` : '');
  item.addEventListener('click', () => selectVoiceChannel(c.id));
  return item;
}

function voiceOccupantsEl(channelId) {
  const wrap = el('div', 'voice-occupants');
  wrap.id = `occupants-${channelId}`;
  const members = appState.voicePresence.get(channelId) || [];
  for (const uid of members) wrap.appendChild(occupantEl(uid));
  return wrap;
}

function occupantEl(uid) {
  const u = getUser(uid);
  const state = appState.voiceStates.get(uid) || {};
  const row = el('div', 'voice-occupant');
  row.id = `occ-${uid}`;
  row.innerHTML = `${avatarHtml('vo-avatar', u)}<span>${escapeHtml(u.username)}</span><span class="vo-badge" id="occ-badge-${uid}">${state.screenOn ? icon('live') : (state.muted ? icon('micOff') : '')}</span>`;
  return row;
}

function voiceChannelForUser(userId) {
  for (const [channelId, members] of appState.voicePresence.entries()) {
    if ((members || []).includes(userId)) return channelId;
  }
  return null;
}

function voiceChannelName(channelId) {
  const g = selectedGuild();
  return g?.channels.find((c) => c.id === channelId)?.name || '';
}

function isChannelInSelectedGuild(channelId) {
  return !!selectedGuild()?.channels.some((c) => c.id === channelId);
}

function renderMemberSidebar() {
  const panel = $('member-sidebar');
  const list = $('member-list');
  const g = selectedGuild();
  if (!g) { panel.classList.add('hidden'); list.innerHTML = ''; return; }

  panel.classList.remove('hidden');
  list.innerHTML = '';

  const members = [...(g.members || [])].sort((a, b) => {
    const aa = appState.onlineUsers.has(a.id) || !!voiceChannelForUser(a.id) || appState.activities.has(a.id);
    const bb = appState.onlineUsers.has(b.id) || !!voiceChannelForUser(b.id) || appState.activities.has(b.id);
    if (aa !== bb) return aa ? -1 : 1;
    return a.username.localeCompare(b.username, 'tr');
  });
  const active = members.filter((m) => appState.onlineUsers.has(m.id) || !!voiceChannelForUser(m.id) || appState.activities.has(m.id));
  const offline = members.filter((m) => !active.includes(m));

  appendMemberSection(list, `Aktif - ${active.length}`, active);
  if (offline.length) appendMemberSection(list, `Çevrimdışı - ${offline.length}`, offline);
}

function appendMemberSection(list, title, members) {
  list.appendChild(el('div', 'member-section', escapeHtml(title)));
  if (!members.length) {
    list.appendChild(el('div', 'member-row', '<div class="member-main"><div class="member-meta">Kimse yok</div></div>'));
    return;
  }
  for (const member of members) list.appendChild(memberRow(member));
}

function memberRow(member) {
  const row = el('div', 'member-row');
  const voiceChannelId = voiceChannelForUser(member.id);
  const state = appState.voiceStates.get(member.id) || {};
  const online = appState.onlineUsers.has(member.id);
  const activityMeta = activityText(appState.activities.get(member.id));
  let meta = state.screenOn
    ? `Ekran paylaşıyor${voiceChannelId ? ' · ' + voiceChannelName(voiceChannelId) : ''}`
    : (voiceChannelId ? `Seste · ${voiceChannelName(voiceChannelId)}` : (online ? 'Çevrimiçi' : 'Çevrimdışı'));
  if (!state.screenOn && !voiceChannelId && activityMeta) meta = activityMeta;
  row.innerHTML = `
    ${avatarHtml('vo-avatar', member)}
    <span class="member-status ${online ? 'online' : ''}"></span>
    <div class="member-main">
      <div class="member-name-line">
        <div class="member-name">${escapeHtml(member.username)}${member.id === appState.me.id ? ' (sen)' : ''}</div>
        ${member.role === 'owner' ? `<span class="owner-badge" title="Sunucu sahibi">${icon('crown')}</span>` : ''}
      </div>
      <div class="member-meta">${escapeHtml(meta)}</div>
    </div>
    ${state.screenOn ? `<button class="watch-btn" data-watch="${member.id}">İzle</button>` : ''}`;
  row.querySelector('[data-watch]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    watchScreenShare(member.id);
  });
  return row;
}

async function watchScreenShare(userId) {
  const channelId = voiceChannelForUser(userId);
  if (!channelId) return;
  if (!appState.voice.connected || appState.voice.channelId !== channelId) {
    await selectVoiceChannel(channelId);
  } else {
    showVoiceView(channelId);
  }
  setTimeout(() => {
    const tile = $(`tile-screen-${userId}`);
    if (tile) {
      tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tile.classList.add('speaking');
      setTimeout(() => tile.classList.remove('speaking'), 900);
    }
  }, 350);
}

// =============================================================
//  Görünüm değişimi
// =============================================================
function swapMain(viewId) {
  for (const v of ['welcome-view', 'text-view', 'voice-view']) $(v).classList.toggle('hidden', v !== viewId);
}

// =============================================================
//  Text kanal sohbeti
// =============================================================
async function selectTextChannel(channelId) {
  appState.view = 'text';
  appState.currentTextChannelId = channelId;
  const g = appState.guilds.get(appState.currentGuildId);
  const ch = g.channels.find((c) => c.id === channelId);
  const isCode = ch?.type === 'code';
  $('text-channel-name').textContent = ch ? ch.name : '';
  $('text-channel-icon').innerHTML = icon(channelIcon(ch?.type));
  $('text-view').classList.toggle('code-mode', isCode);
  $('composer-input').placeholder = isCode ? 'Kod paylaş… Ctrl+Enter ile gönder' : 'Mesaj yaz…';
  $('composer-input').value = '';
  pendingAttachments = [];
  renderAttachmentTray();
  swapMain('text-view');
  renderChannelList();

  $('messages').innerHTML = '<p class="loading">Yükleniyor…</p>';
  try {
    const { messages } = await window.Api.messages(channelId);
    appState.messages.set(channelId, messages);
    renderMessages(channelId);
  } catch (e) {
    $('messages').innerHTML = `<p class="loading">Mesajlar yüklenemedi: ${escapeHtml(e.message)}</p>`;
  }
  $('composer-input').focus();
}

function renderMessages(channelId) {
  const box = $('messages');
  box.innerHTML = '';
  const list = appState.messages.get(channelId) || [];
  let prev = null;
  for (const m of list) { box.appendChild(messageEl(m, prev)); prev = m; }
  box.scrollTop = box.scrollHeight;
}

function messageEl(m, prev) {
  const grouped = prev && prev.author.id === m.author.id && (m.createdAt - prev.createdAt < 5 * 60 * 1000);
  const d = el('div', 'msg' + (grouped ? ' grouped' : '') + (m.pending ? ' pending' : ''));
  d.id = `msg-${m.id}`;
  const time = new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const channel = appState.guilds.get(appState.currentGuildId)?.channels.find((c) => c.id === m.channelId);
  const hasContent = String(m.content || '').trim().length > 0;
  const body = !hasContent
    ? ''
    : channel?.type === 'code'
    ? `<div class="code-wrap"><button class="code-copy" title="Kodu kopyala">${icon('copy')}</button><pre class="msg-code"><code>${highlightCode(m.content)}</code></pre></div>`
    : `<div class="msg-text">${escapeHtml(m.content)}</div>`;
  d.innerHTML = `
    ${avatarHtml('msg-avatar', m.author)}
    <div class="msg-body">
      ${grouped ? '' : `<div class="msg-head"><span class="msg-author">${escapeHtml(m.author.username)}</span><span class="msg-time">${time}</span></div>`}
      ${body}
      ${renderAttachments(m.attachments)}
    </div>`;
  d.querySelector('.code-copy')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(m.content || '');
    const btn = d.querySelector('.code-copy');
    if (btn) {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 900);
    }
  });
  return d;
}

// Mesaj gönderme (optimistik)
let typingThrottle = 0;
$('composer-input').addEventListener('keydown', (e) => {
  const isCode = currentMessageChannel()?.type === 'code';
  if (e.key === 'Enter' && ((isCode && (e.ctrlKey || e.metaKey)) || (!isCode && !e.shiftKey))) { e.preventDefault(); sendMessage(); }
  else {
    const now = Date.now();
    if (now - typingThrottle > 3000 && appState.currentTextChannelId) {
      typingThrottle = now;
      window.gateway.send({ type: 'typing', channelId: appState.currentTextChannelId });
    }
  }
});
$('composer-input').addEventListener('input', () => {
  const input = $('composer-input');
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 220) + 'px';
});
$('btn-attach-file').addEventListener('click', () => {
  const ch = currentMessageChannel();
  if (!ch || !['text', 'code'].includes(ch.type)) return;
  $('file-input').click();
});
$('file-input').addEventListener('change', async (e) => {
  const ch = currentMessageChannel();
  if (!ch) return;
  const files = [...(e.target.files || [])].slice(0, Math.max(0, 5 - pendingAttachments.length));
  e.target.value = '';
  if (!files.length) return;
  $('btn-attach-file').disabled = true;
  try {
    for (const file of files) {
      if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name} en fazla 15 MB olabilir`);
      const data = await fileToDataUrl(file);
      const { attachment } = await window.Api.uploadFile(ch.id, { name: file.name, mimeType: file.type || 'application/octet-stream', data });
      pendingAttachments.push(attachment);
      renderAttachmentTray();
    }
  } catch (err) {
    alert(err.message);
  } finally {
    $('btn-attach-file').disabled = false;
  }
});
$('attachment-tray').addEventListener('click', (e) => {
  const remove = e.target.closest('.chip-remove');
  if (!remove) return;
  const chip = remove.closest('[data-attachment-id]');
  pendingAttachments = pendingAttachments.filter((a) => a.id !== chip?.dataset.attachmentId);
  renderAttachmentTray();
});

function sendMessage() {
  const input = $('composer-input');
  const isCode = currentMessageChannel()?.type === 'code';
  const raw = input.value;
  const content = isCode ? raw.replace(/\s+$/g, '') : raw.trim();
  const channelId = appState.currentTextChannelId;
  const attachments = pendingAttachments;
  if ((!content.trim() && attachments.length === 0) || !channelId) return;
  input.value = '';
  input.style.height = 'auto';
  pendingAttachments = [];
  renderAttachmentTray();

  const nonce = 'n' + Math.random().toString(36).slice(2);
  const optimistic = { id: nonce, nonce, channelId, content, attachments, createdAt: Date.now(), author: appState.me, pending: true };
  const list = appState.messages.get(channelId) || [];
  list.push(optimistic);
  appState.messages.set(channelId, list);
  if (appState.view === 'text' && appState.currentTextChannelId === channelId) {
    const box = $('messages');
    box.appendChild(messageEl(optimistic, list[list.length - 2]));
    box.scrollTop = box.scrollHeight;
  }
  window.gateway.send({ type: 'send-message', channelId, content, attachments, nonce });
}

function onMessageCreated(m) {
  cacheUser(m.author);
  const list = appState.messages.get(m.channelId) || [];
  const isOwnMessage = m.author?.id === appState.me?.id;

  // Optimistik mesajı eşleştir (nonce)
  if (m.nonce) {
    const idx = list.findIndex((x) => x.nonce === m.nonce);
    if (idx !== -1) {
      list[idx] = { ...m, pending: false };
      appState.messages.set(m.channelId, list);
      if (isViewingChannel(m.channelId)) {
        const node = $(`msg-${m.nonce}`);
        if (node) node.replaceWith(messageEl(list[idx], list[idx - 1]));
      }
      return;
    }
  }
  if (list.some((x) => x.id === m.id)) return;
  if (!isOwnMessage) playSound('message');
  list.push(m);
  appState.messages.set(m.channelId, list);
  if (isViewingChannel(m.channelId)) {
    const box = $('messages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.appendChild(messageEl(m, list[list.length - 2]));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
}

function isViewingChannel(channelId) {
  return appState.view === 'text' && appState.currentTextChannelId === channelId;
}

// Yazıyor göstergesi
const typingUsers = new Map(); // channelId -> Map<userId, timeout>
function onTyping({ channelId, userId, username }) {
  if (!typingUsers.has(channelId)) typingUsers.set(channelId, new Map());
  const m = typingUsers.get(channelId);
  clearTimeout(m.get(userId));
  m.set(userId, setTimeout(() => { m.delete(userId); renderTyping(channelId); }, 4000));
  cacheUser({ id: userId, username });
  renderTyping(channelId);
}
function renderTyping(channelId) {
  if (!isViewingChannel(channelId)) { $('typing-indicator').textContent = ''; return; }
  const m = typingUsers.get(channelId);
  const names = m ? [...m.keys()].map((id) => getUser(id).username) : [];
  $('typing-indicator').textContent = names.length ? `${names.join(', ')} yazıyor…` : '';
}

// =============================================================
//  Ses kanalı
// =============================================================
async function selectVoiceChannel(channelId) {
  // Zaten bu kanaldaysak sadece görünüme geç
  if (appState.voice.connected && appState.voice.channelId === channelId) {
    showVoiceView(channelId);
    return;
  }
  await joinVoice(channelId);
}

async function joinVoice(channelId) {
  if (appState.voice.connected) await leaveVoice();

  const guildId = appState.currentGuildId;
  const profile = window.CONFIG.qualityProfiles[window.Store.get('profileKey')];

  // Mikrofonu başlat
  try {
    await media.startMic(window.Store.get('micId'));
  } catch (e) { alert('Mikrofona erişilemedi: ' + e.message); return; }

  appState.voice.connected = true;
  appState.voice.channelId = channelId;
  appState.voice.guildId = guildId;

  await mesh.join(channelId, profile);

  showVoiceView(channelId);
  addVoiceTile(appState.me.id); // kendi tile'ımız
  startVAD(media.micStream, appState.me.id);
  applyMicEnabled();
  broadcastVoiceState();

  updateVoiceStatusBar();
  startPTTIfNeeded();
  playSound('join');
}

async function leaveVoice() {
  const wasConnected = appState.voice.connected;
  mesh.leave();
  for (const audio of appState.voice.audioEls.values()) audio.remove();
  appState.voice.audioEls.clear();
  appState.voice.pings.clear();
  stopAllVAD();
  media.stopMic(); media.stopCamera(); media.stopScreen();

  appState.voice = { ...appState.voice, connected: false, channelId: null, guildId: null, camOn: false, screenOn: false };
  rememberVoiceState(appState.me.id, { muted: appState.voice.muted, camOn: false, screenOn: false });
  $('voice-grid').innerHTML = '';
  updateVoiceStatusBar();
  stopPTT();
  renderMemberSidebar();

  if (appState.view === 'voice') {
    // text görünümüne geri dön
    const g = appState.guilds.get(appState.currentGuildId);
    const t = g?.channels.find((c) => c.type === 'text');
    if (t) selectTextChannel(t.id); else showWelcome();
  } else {
    renderChannelList();
  }
  if (wasConnected) playSound('leave');
}

function showVoiceView(channelId) {
  appState.view = 'voice';
  const g = appState.guilds.get(appState.voice.guildId || appState.currentGuildId);
  const ch = g?.channels.find((c) => c.id === channelId);
  $('voice-channel-name').textContent = ch ? ch.name : 'Ses';
  swapMain('voice-view');
  renderChannelList();
}

// --- Ses tile yönetimi ---
function addVoiceTile(userId) {
  if ($(`tile-voice-${userId}`)) return;
  const u = getUser(userId);
  const isSelf = userId === appState.me.id;
  const tile = el('div', 'tile');
  tile.id = `tile-voice-${userId}`;
  tile.innerHTML = `
    ${avatarHtml('avatar-big', u)}
    <video id="video-voice-${userId}" autoplay playsinline ${isSelf ? 'muted' : ''} style="display:none"></video>
    <div class="name-tag">${escapeHtml(u.username)}${isSelf ? ' (sen)' : ''}</div>
    <div class="badges" id="badges-${userId}"></div>
    ${isSelf ? '' : `<div class="tile-ping" id="tileping-${userId}">— ms</div>`}`;
  $('voice-grid').appendChild(tile);
}

function removeVoiceTile(userId) {
  $(`tile-voice-${userId}`)?.remove();
  $(`tile-screen-${userId}`)?.remove();
}

function handleRemoteTrack(userId, type, track, stream) {
  if (type === 'mic') {
    let audio = appState.voice.audioEls.get(userId);
    if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; document.body.appendChild(audio); appState.voice.audioEls.set(userId, audio); }
    audio.srcObject = new MediaStream([track]);
    audio.muted = appState.voice.speakerMuted;
    audio.volume = outputVolume();
    media.applySinkId(audio);
    startVAD(new MediaStream([track]), userId);
  } else if (type === 'camera') {
    showVideoOnTile(userId, track);
  } else if (type === 'screen') {
    rememberVoiceState(userId, { screenOn: true });
    renderMemberSidebar();
    showScreenTile(userId, track);
  }
}

function showVideoOnTile(userId, track) {
  const video = $(`video-voice-${userId}`);
  const tile = $(`tile-voice-${userId}`);
  if (!video || !tile) return;
  video.srcObject = new MediaStream([track]);
  const avatar = tile.querySelector('.avatar-big');
  const update = () => {
    const live = track.readyState === 'live' && !track.muted;
    video.style.display = live ? 'block' : 'none';
    if (avatar) avatar.style.display = live ? 'none' : 'flex';
  };
  track.onmute = update; track.onunmute = update; update();
}

function showScreenTile(userId, track) {
  const u = getUser(userId);
  let tile = $(`tile-screen-${userId}`);
  if (!tile) {
    tile = el('div', 'tile screen-tile');
    tile.id = `tile-screen-${userId}`;
    tile.innerHTML = `<video id="video-screen-${userId}" autoplay playsinline ${userId === appState.me.id ? 'muted' : ''}></video><div class="name-tag">${icon('screen')} ${escapeHtml(u.username)} — ekran</div>`;
    $('voice-grid').appendChild(tile);
  }
  $(`video-screen-${userId}`).srcObject = new MediaStream([track]);
  tile.style.display = 'flex';
  track.onmute = () => { tile.style.display = 'none'; };
  track.onunmute = () => { tile.style.display = 'flex'; };
}

// =============================================================
//  Ses kontrolleri (mikrofon / hoparlör / kamera / ekran / ayrıl)
// =============================================================
function applyMicEnabled() {
  const v = appState.voice;
  let on;
  if (v.muted) on = false;
  else if (appState.mode === 'ptt') on = appState.pttActive;
  else on = true;
  media.setMicMuted(!on);
}

function toggleMute() {
  appState.voice.muted = !appState.voice.muted;
  applyMicEnabled();
  updateVoiceButtons();
  broadcastVoiceState();
}

function toggleSpeakerMute() {
  appState.voice.speakerMuted = !appState.voice.speakerMuted;
  for (const audio of appState.voice.audioEls.values()) audio.muted = appState.voice.speakerMuted;
  updateVoiceButtons();
}

function updateVoiceButtons() {
  const v = appState.voice;
  $('btn-mic').classList.toggle('off', v.muted);
  $('btn-mic').innerHTML = icon(v.muted ? 'micOff' : 'mic');
  $('btn-deafen').classList.toggle('off', v.speakerMuted);
  $('btn-deafen').innerHTML = icon(v.speakerMuted ? 'speakerOff' : 'speaker');
  $('btn-deafen').title = v.speakerMuted ? 'Hoparlör sessizde' : 'Hoparlörü sustur';
  $('vc-mic').classList.toggle('off', v.muted);
  $('vc-mic').querySelector('.ico').innerHTML = icon(v.muted ? 'micOff' : 'mic');
  $('vc-cam').classList.toggle('active', v.camOn);
  $('vc-screen').classList.toggle('active', v.screenOn);
}

$('btn-mic').addEventListener('click', toggleMute);
$('btn-deafen').addEventListener('click', toggleSpeakerMute);
$('vc-mic').addEventListener('click', toggleMute);
$('vc-leave').addEventListener('click', leaveVoice);
$('btn-disconnect').addEventListener('click', leaveVoice);

// Kamera
$('vc-cam').addEventListener('click', async () => {
  const v = appState.voice;
  if (!v.connected) return;
  if (!v.camOn) {
    try {
      const profile = window.CONFIG.qualityProfiles[window.Store.get('profileKey')];
      await media.startCamera(window.Store.get('cameraId'), profile.cameraHeight);
      v.camOn = true;
      await mesh.updateTrack('camera');
      showVideoOnTile(appState.me.id, media.cameraTrack);
      playSound('camera');
    } catch (e) { alert('Kameraya erişilemedi: ' + e.message); return; }
  } else {
    media.stopCamera(); v.camOn = false;
    await mesh.updateTrack('camera');
    const video = $(`video-voice-${appState.me.id}`); if (video) { video.style.display = 'none'; video.srcObject = null; }
    const av = $(`tile-voice-${appState.me.id}`)?.querySelector('.avatar-big'); if (av) av.style.display = 'flex';
  }
  updateVoiceButtons();
  broadcastVoiceState();
});

// Ekran paylaşımı
$('vc-screen').addEventListener('click', async () => {
  const v = appState.voice;
  if (!v.connected) return;
  if (v.screenOn) {
    media.stopScreen(); v.screenOn = false;
    await mesh.updateTrack('screen');
    $(`tile-screen-${appState.me.id}`)?.remove();
    updateVoiceButtons();
    broadcastVoiceState();
  } else {
    openScreenModal();
  }
});

// =============================================================
//  Ekran paylaşım seçici
// =============================================================
function openScreenModal() { $('screen-modal').classList.remove('hidden'); loadScreenSources('screen'); }
let currentSourceTab = 'screen';
document.querySelectorAll('.source-tabs .tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.source-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
  currentSourceTab = tab.dataset.tab; loadScreenSources(currentSourceTab);
}));

async function loadScreenSources(filterType) {
  const list = $('source-list');
  list.innerHTML = '<p class="loading">Kaynaklar yükleniyor…</p>';
  const sources = await window.desktop.getScreenSources();
  const filtered = sources.filter((s) => s.type === filterType);
  list.innerHTML = '';
  if (!filtered.length) { list.innerHTML = '<p class="loading">Kaynak bulunamadı.</p>'; return; }
  for (const src of filtered) {
    const item = el('div', 'source-item', `<img src="${src.thumbnail}" /><div class="src-name">${escapeHtml(src.name)}</div>`);
    item.addEventListener('click', () => startScreenShare(src.id));
    list.appendChild(item);
  }
}

async function startScreenShare(sourceId) {
  const height = parseInt($('sel-resolution').value, 10);
  const fps = parseInt($('sel-fps').value, 10);
  const withAudio = $('chk-sysaudio').checked;
  const width = Math.round((height * 16) / 9);
  try {
    await media.startScreen(sourceId, { maxWidth: width, maxHeight: height, fps, withAudio });
  } catch (e) { alert('Ekran paylaşımı başlatılamadı: ' + e.message); return; }

  appState.voice.screenOn = true;
  await mesh.updateTrack('screen');
  showScreenTile(appState.me.id, media.screenTrack);
  playSound('stream');
  media.screenTrack.onended = async () => {
    appState.voice.screenOn = false;
    await mesh.updateTrack('screen');
    $(`tile-screen-${appState.me.id}`)?.remove();
    updateVoiceButtons(); broadcastVoiceState();
  };
  $('screen-modal').classList.add('hidden');
  updateVoiceButtons();
  broadcastVoiceState();
}

// =============================================================
//  Ses durumu yayını + presence
// =============================================================
function broadcastVoiceState() {
  const state = { muted: appState.voice.muted, camOn: appState.voice.camOn, screenOn: appState.voice.screenOn };
  rememberVoiceState(appState.me.id, state);
  applyPeerBadges(appState.me.id, state);
  mesh.broadcastState(state);
}

function rememberVoiceState(userId, state) {
  appState.voiceStates.set(userId, { ...(appState.voiceStates.get(userId) || {}), ...(state || {}) });
}

function onVoicePeerState({ channelId, userId, state }) {
  const previous = appState.voiceStates.get(userId) || {};
  const next = { ...previous, ...(state || {}) };
  const isRemote = userId !== appState.me?.id;
  const shouldNotify = channelId === appState.voice.channelId || isChannelInSelectedGuild(channelId);
  if (isRemote && shouldNotify) {
    if (!previous.screenOn && next.screenOn) playSound('stream');
    if (!previous.camOn && next.camOn) playSound('camera');
  }
  rememberVoiceState(userId, state);
  if (channelId === appState.voice.channelId) applyPeerBadges(userId, state);
  else renderMemberSidebar();
}

function updateVoiceStatusBar() {
  const bar = $('voice-status');
  if (!appState.voice.connected) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const g = appState.guilds.get(appState.voice.guildId);
  const ch = g?.channels.find((c) => c.id === appState.voice.channelId);
  $('vs-channel').textContent = (g ? g.name + ' / ' : '') + (ch ? ch.name : '');
  $('vs-state').textContent = 'Ses bağlı';
  recomputePing();
}

function applyPeerBadges(userId, state) {
  rememberVoiceState(userId, state);
  const html = (state.muted ? `<span class="badge muted">${icon('micOff')}</span>` : '') + (state.camOn ? `<span class="badge">${icon('camera')}</span>` : '') + (state.screenOn ? `<span class="badge">${icon('screen')}</span>` : '');
  const b = $(`badges-${userId}`); if (b) b.innerHTML = html;
  const ob = $(`occ-badge-${userId}`); if (ob) ob.innerHTML = state.screenOn ? icon('live') : (state.muted ? icon('micOff') : '');
  renderMemberSidebar();
}

function recomputePing() {
  const pings = [...appState.voice.pings.values()].filter((x) => x != null);
  const disp = $('ping-display'); const bar = $('voice-status');
  if (!pings.length) { $('ping-value').textContent = '— ms'; disp.classList.remove('warn', 'bad'); bar.classList.remove('warn', 'bad'); return; }
  const avg = Math.round(pings.reduce((a, b) => a + b, 0) / pings.length);
  $('ping-value').textContent = `${avg} ms`;
  for (const t of [disp, bar]) { t.classList.toggle('warn', avg >= 80 && avg < 150); t.classList.toggle('bad', avg >= 150); }
}

// =============================================================
//  Gateway olayları
// =============================================================
function wireGateway() {
  const g = window.gateway;

  // Text
  g.on('message-created', ({ message }) => onMessageCreated(message));
  g.on('typing', onTyping);

  // Guild/kanal güncellemeleri
  g.on('channel-created', ({ guildId, channel }) => { const gu = appState.guilds.get(guildId); if (gu && !gu.channels.some((c) => c.id === channel.id)) { gu.channels.push(channel); if (guildId === appState.currentGuildId) { renderChannelList(); renderMemberSidebar(); renderServerSettingsChannels(); } } });
  g.on('channel-deleted', ({ guildId, channelId }) => { const gu = appState.guilds.get(guildId); if (gu) { gu.channels = gu.channels.filter((c) => c.id !== channelId); if (guildId === appState.currentGuildId) { renderServerSettingsChannels(); if (appState.currentTextChannelId === channelId) selectGuild(guildId); else { renderChannelList(); renderMemberSidebar(); } } } });
  g.on('channel-updated', ({ guildId, channelId, name }) => { const gu = appState.guilds.get(guildId); if (gu) { const c = gu.channels.find((x) => x.id === channelId); if (c) c.name = name; if (guildId === appState.currentGuildId) { renderChannelList(); renderMemberSidebar(); renderServerSettingsChannels(); if (appState.currentTextChannelId === channelId) $('text-channel-name').textContent = name; } } });
  g.on('guild-updated', ({ guildId, name, iconImage }) => {
    const gu = appState.guilds.get(guildId);
    if (!gu) return;
    gu.name = name;
    if (iconImage !== undefined) gu.iconImage = iconImage || null;
    if (guildId === appState.currentGuildId) {
      $('guild-header-name').textContent = name;
      if (!$('server-settings-modal').classList.contains('hidden')) {
        serverDraftIcon = gu.iconImage || null;
        renderServerImagePreview();
      }
    }
    renderGuildRail();
  });
  g.on('member-joined', ({ guildId, member }) => { const gu = appState.guilds.get(guildId); if (gu) { cacheUser(member); if (!gu.members.some((m) => m.id === member.id)) gu.members.push(member); if (guildId === appState.currentGuildId) renderMemberSidebar(); } });
  g.on('member-updated', ({ guildId, member }) => { updateCachedMember(member); if (member.id === appState.me.id) { appState.me = cacheUser({ ...appState.me, ...member }); $('up-name').textContent = appState.me.username; renderAvatar($('up-avatar'), appState.me); } if (guildId === appState.currentGuildId) { renderMemberSidebar(); renderServerSettingsMembers(); renderChannelList(); } });
  g.on('member-left', ({ guildId, userId }) => { const gu = appState.guilds.get(guildId); if (gu) { gu.members = gu.members.filter((m) => m.id !== userId); if (guildId === appState.currentGuildId) renderMemberSidebar(); } });
  g.on('guild-deleted', ({ guildId }) => { appState.guilds.delete(guildId); if (appState.currentGuildId === guildId) { appState.currentGuildId = null; showWelcome(); } renderGuildRail(); });
  g.on('presence-sync', ({ guilds, activities }) => {
    appState.onlineUsers.clear();
    appState.activities.clear();
    for (const ids of Object.values(guilds || {})) for (const id of ids) appState.onlineUsers.add(id);
    for (const byUser of Object.values(activities || {})) {
      for (const [userId, activity] of Object.entries(byUser || {})) {
        if (activity) appState.activities.set(userId, activity);
      }
    }
    renderMemberSidebar();
  });
  g.on('member-presence', ({ userId, online }) => { if (online) appState.onlineUsers.add(userId); else { appState.onlineUsers.delete(userId); appState.activities.delete(userId); } renderMemberSidebar(); });
  g.on('member-activity', ({ userId, activity }) => { if (activity) appState.activities.set(userId, activity); else appState.activities.delete(userId); renderMemberSidebar(); });

  // Ses presence (sidebar doluluk)
  g.on('voice-presence', ({ channelId, members }) => {
    const previous = appState.voicePresence.get(channelId) || [];
    const next = members || [];
    if (channelId !== appState.voice.channelId && isChannelInSelectedGuild(channelId)) {
      const joined = next.some((id) => id !== appState.me?.id && !previous.includes(id));
      const left = previous.some((id) => id !== appState.me?.id && !next.includes(id));
      if (joined) playSound('join');
      else if (left) playSound('leave');
    }
    if (members && members.length) appState.voicePresence.set(channelId, members);
    else appState.voicePresence.delete(channelId);
    if (appState.currentGuildId) { renderChannelList(); renderMemberSidebar(); }
  });
  g.on('voice-peer-joined', ({ channelId, userId, user }) => { cacheUser(user); if (channelId === appState.voice.channelId) { addVoiceTile(userId); if (userId !== appState.me?.id) playSound('join'); } });
  g.on('voice-peer-left', ({ channelId, userId }) => { appState.voiceStates.delete(userId); renderMemberSidebar(); if (channelId === appState.voice.channelId) { if (userId !== appState.me?.id) playSound('leave'); removeVoiceTile(userId); appState.voice.pings.delete(userId); const a = appState.voice.audioEls.get(userId); if (a) { a.remove(); appState.voice.audioEls.delete(userId); } stopVAD(userId); recomputePing(); } });
  g.on('voice-joined', ({ channelId, peers }) => { if (channelId !== appState.voice.channelId) return; for (const p of peers) { cacheUser(p.user); addVoiceTile(p.userId); if (p.state) applyPeerBadges(p.userId, p.state); } });
  g.on('voice-peer-state', onVoicePeerState);

  g.on('disconnected', () => { $('vs-state') && ($('vs-state').textContent = 'Yeniden bağlanıyor…'); });
}

// Mesh → UI köprüsü
mesh.onRemoteTrack = handleRemoteTrack;
mesh.onRemoteTrackEnded = (userId, type) => {
  if (type === 'camera') { const v = $(`video-voice-${userId}`); if (v) v.style.display = 'none'; const a = $(`tile-voice-${userId}`)?.querySelector('.avatar-big'); if (a) a.style.display = 'flex'; }
  if (type === 'screen') { rememberVoiceState(userId, { screenOn: false }); $(`tile-screen-${userId}`)?.remove(); renderMemberSidebar(); }
};
mesh.onStats = (userId, { rttMs }) => { appState.voice.pings.set(userId, rttMs); const t = $(`tileping-${userId}`); if (t) t.textContent = `${rttMs} ms`; recomputePing(); };

// =============================================================
//  Konuşma algılama (VAD) → yeşil çerçeve
// =============================================================
const vadCtx = new Map();
function startVAD(stream, userId) {
  stopVAD(userId);
  if (!stream || stream.getAudioTracks().length === 0) return;
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let raf;
  const loop = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const db = 20 * Math.log10(Math.max(rms, 0.00001));
    const threshold = clampNumber(window.Store.get('vadThresholdDb'), -80, -20, -55);
    const isSelf = userId === appState.me.id;
    const micActive = !isSelf || (!appState.voice.muted && (appState.mode !== 'ptt' || appState.pttActive));
    const speaking = db > threshold && micActive;
    $(`tile-voice-${userId}`)?.classList.toggle('speaking', speaking);
    $(`occ-${userId}`)?.classList.toggle('speaking', speaking);
    raf = requestAnimationFrame(loop);
  };
  loop();
  vadCtx.set(userId, { ctx, stop: () => cancelAnimationFrame(raf) });
}
function stopVAD(userId) { const v = vadCtx.get(userId); if (v) { v.stop(); v.ctx.close(); vadCtx.delete(userId); } }
function stopAllVAD() { for (const id of [...vadCtx.keys()]) stopVAD(id); }

// =============================================================
//  Modallar
// =============================================================
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $(b.dataset.close).classList.add('hidden')));
document.querySelectorAll('.modal').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) m.classList.add('hidden'); }));

// Sunucu ekle
$('btn-add-guild').addEventListener('click', () => { $('add-guild-error').textContent = ''; $('add-guild-modal').classList.remove('hidden'); $('new-guild-name').focus(); });
$('btn-welcome-create').addEventListener('click', () => { $('add-guild-modal').classList.remove('hidden'); $('new-guild-name').focus(); });
document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('seg-create').classList.toggle('hidden', b.dataset.seg !== 'create');
  $('seg-join').classList.toggle('hidden', b.dataset.seg !== 'join');
}));
$('btn-create-guild').addEventListener('click', async () => {
  const name = $('new-guild-name').value.trim();
  try { const { guild } = await window.Api.createGuild(name); indexGuild(guild); $('add-guild-modal').classList.add('hidden'); $('new-guild-name').value = ''; renderGuildRail(); selectGuild(guild.id); }
  catch (e) { $('add-guild-error').textContent = e.message; }
});
$('btn-join-guild').addEventListener('click', async () => {
  const code = $('join-code').value.trim();
  try { const { guild } = await window.Api.joinGuild(code); indexGuild(guild); $('add-guild-modal').classList.add('hidden'); $('join-code').value = ''; renderGuildRail(); selectGuild(guild.id); }
  catch (e) { $('add-guild-error').textContent = e.message; }
});

// Sunucu menüsü
$('btn-guild-menu').addEventListener('click', openGuildMenu);
$('guild-header').addEventListener('click', (e) => { if (e.target.closest('#btn-guild-menu')) return; });
function openGuildMenu() {
  const g = appState.guilds.get(appState.currentGuildId);
  if (!g) return;
  $('gm-title').textContent = g.name;
  $('gm-invite').value = g.inviteCode;
  const isOwner = g.ownerId === appState.me.id;
  $('btn-delete-guild').classList.toggle('hidden', !isOwner);
  $('btn-leave-guild').classList.toggle('hidden', isOwner);
  $('btn-server-settings').classList.toggle('hidden', !isOwner);
  $('btn-add-channel').classList.toggle('hidden', !isOwner);
  $('guild-menu-modal').classList.remove('hidden');
}
$('btn-copy-invite').addEventListener('click', () => { navigator.clipboard.writeText($('gm-invite').value); $('btn-copy-invite').textContent = 'Kopyalandı!'; setTimeout(() => $('btn-copy-invite').textContent = 'Kopyala', 1500); });
$('btn-server-settings').addEventListener('click', openServerSettings);
$('btn-add-channel').addEventListener('click', () => { $('guild-menu-modal').classList.add('hidden'); $('add-channel-error').textContent = ''; $('add-channel-modal').classList.remove('hidden'); $('new-channel-name').focus(); });
$('btn-create-channel').addEventListener('click', async () => {
  const name = $('new-channel-name').value.trim();
  const type = document.querySelector('input[name="ch-type"]:checked').value;
  try { await window.Api.createChannel(appState.currentGuildId, name, type); $('add-channel-modal').classList.add('hidden'); $('new-channel-name').value = ''; }
  catch (e) { $('add-channel-error').textContent = e.message; }
});
$('btn-leave-guild').addEventListener('click', async () => {
  if (!confirm('Sunucudan ayrılmak istediğine emin misin?')) return;
  await window.Api.leaveGuild(appState.currentGuildId);
  appState.guilds.delete(appState.currentGuildId);
  appState.currentGuildId = null; $('guild-menu-modal').classList.add('hidden'); renderGuildRail(); showWelcome();
});
$('btn-delete-guild').addEventListener('click', async () => {
  if (!confirm('Sunucu kalıcı olarak silinecek. Emin misin?')) return;
  await window.Api.deleteGuild(appState.currentGuildId);
  appState.guilds.delete(appState.currentGuildId);
  appState.currentGuildId = null; $('guild-menu-modal').classList.add('hidden'); renderGuildRail(); showWelcome();
});

function openServerSettings() {
  const g = selectedGuild();
  if (!g || g.ownerId !== appState.me.id) return;
  $('guild-menu-modal').classList.add('hidden');
  $('server-settings-error').textContent = '';
  $('server-settings-name').value = g.name;
  $('server-settings-invite').value = g.inviteCode;
  $('server-image-input').value = '';
  serverDraftIcon = g.iconImage || null;
  renderServerImagePreview();
  renderServerSettingsMembers();
  renderServerSettingsChannels();
  $('server-settings-modal').classList.remove('hidden');
  $('server-settings-name').focus();
}

function renderServerSettingsMembers() {
  const g = selectedGuild();
  const list = $('server-settings-members');
  list.innerHTML = '';
  if (!g) return;
  for (const member of [...(g.members || [])].sort((a, b) => a.username.localeCompare(b.username, 'tr'))) {
    const row = el('div', 'settings-member-row');
    row.innerHTML = `${avatarHtml('vo-avatar', member)}<span>${escapeHtml(member.username)}</span>${member.role === 'owner' ? `<span class="owner-badge" title="Sunucu sahibi">${icon('crown')}</span>` : ''}<span class="member-role">${member.role === 'owner' ? 'Sahip' : 'Üye'}</span>`;
    list.appendChild(row);
  }
}

function renderServerSettingsChannels() {
  const g = selectedGuild();
  const list = $('server-settings-channels');
  list.innerHTML = '';
  if (!g) return;
  for (const ch of [...(g.channels || [])].sort((a, b) => {
    const order = { text: 0, code: 1, voice: 2 };
    return (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.position - b.position || a.name.localeCompare(b.name, 'tr');
  })) {
    const row = el('div', 'settings-channel-row');
    row.dataset.channelId = ch.id;
    row.innerHTML = `
      <span class="ci-icon">${icon(channelIcon(ch.type))}</span>
      <input type="text" value="${escapeHtml(ch.name)}" maxlength="32" aria-label="Kanal adı" />
      <div class="settings-channel-actions">
        <button class="icon-btn" data-action="rename" title="Kanal adını kaydet">${icon('settings')}</button>
        <button class="icon-btn danger" data-action="delete" title="Kanalı sil">${icon('trash')}</button>
      </div>`;
    list.appendChild(row);
  }
}

$('btn-server-settings-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('server-settings-invite').value);
  $('btn-server-settings-copy').textContent = 'Kopyalandı!';
  setTimeout(() => $('btn-server-settings-copy').textContent = 'Kopyala', 1500);
});

$('server-settings-name').addEventListener('input', renderServerImagePreview);
$('btn-upload-server-image').addEventListener('click', () => $('server-image-input').click());
$('btn-remove-server-image').addEventListener('click', () => {
  serverDraftIcon = null;
  $('server-image-input').value = '';
  renderServerImagePreview();
});
$('server-image-input').addEventListener('change', async (e) => {
  $('server-settings-error').textContent = '';
  try {
    serverDraftIcon = await imageFileToDataUrl(e.target.files?.[0], 384);
    renderServerImagePreview();
  } catch (err) {
    $('server-settings-error').textContent = err.message;
  } finally {
    e.target.value = '';
  }
});

$('server-settings-channels').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const row = button.closest('.settings-channel-row');
  const channelId = row?.dataset.channelId;
  const g = selectedGuild();
  const ch = g?.channels.find((c) => c.id === channelId);
  if (!channelId || !ch) return;
  $('server-settings-error').textContent = '';
  try {
    if (button.dataset.action === 'rename') {
      await window.Api.renameChannel(channelId, row.querySelector('input').value.trim());
    } else if (button.dataset.action === 'delete') {
      if (!confirm(`${ch.name} kanalı silinsin mi?`)) return;
      await window.Api.deleteChannel(channelId);
      if (appState.currentTextChannelId === channelId) {
        appState.currentTextChannelId = null;
        const next = g.channels.find((c) => c.id !== channelId && (c.type === 'text' || c.type === 'code'));
        if (next) selectTextChannel(next.id);
        else { swapMain('welcome-view'); renderChannelList(); renderMemberSidebar(); }
      }
    }
  } catch (err) {
    $('server-settings-error').textContent = err.message;
  }
});

$('btn-save-server-settings').addEventListener('click', async () => {
  const g = selectedGuild();
  if (!g) return;
  $('server-settings-error').textContent = '';
  $('btn-save-server-settings').disabled = true;
  try {
    const { guild } = await window.Api.updateGuild(g.id, $('server-settings-name').value.trim(), serverDraftIcon);
    indexGuild(guild);
    appState.currentGuildId = guild.id;
    $('guild-header-name').textContent = guild.name;
    renderGuildRail();
    renderChannelList();
    renderMemberSidebar();
    $('server-settings-modal').classList.add('hidden');
  } catch (e) {
    $('server-settings-error').textContent = e.message;
  } finally {
    $('btn-save-server-settings').disabled = false;
  }
});

// =============================================================
//  Ayarlar
// =============================================================
$('btn-settings').addEventListener('click', async () => {
  $('settings-modal').classList.remove('hidden');
  setSettingsTab('profile');
  fillProfileSettings();
  await refreshDeviceLists();
  fillProfileSelect();
  syncSettingsUI();
});
document.querySelectorAll('.st-tab').forEach((t) => t.addEventListener('click', () => {
  setSettingsTab(t.dataset.tab);
}));

function setSettingsTab(tab) {
  document.querySelectorAll('.st-tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  for (const p of ['profile', 'devices', 'voice', 'keys']) $(`st-${p}`).classList.toggle('hidden', p !== tab);
}

async function refreshDeviceLists() {
  const { mics, speakers, cameras } = await media.enumerateDevices();
  fillDeviceSelect($('sel-mic'), mics, window.Store.get('micId'));
  fillDeviceSelect($('sel-speaker'), speakers, window.Store.get('speakerId'));
  fillDeviceSelect($('sel-camera'), cameras, window.Store.get('cameraId'));
}
function fillDeviceSelect(sel, devices, selectedId) {
  sel.innerHTML = '';
  devices.forEach((d, i) => { const o = el('option'); o.value = d.deviceId; o.textContent = d.label || `Cihaz ${i + 1}`; if (d.deviceId === selectedId) o.selected = true; sel.appendChild(o); });
}
function fillProfileSelect() {
  const sel = $('sel-profile'); sel.innerHTML = '';
  for (const [key, p] of Object.entries(window.CONFIG.qualityProfiles)) { const o = el('option'); o.value = key; o.textContent = p.label; if (key === window.Store.get('profileKey')) o.selected = true; sel.appendChild(o); }
  updateProfileHint();
}
function updateProfileHint() {
  const p = window.CONFIG.qualityProfiles[window.Store.get('profileKey')];
  $('settings-profile-hint').textContent = `Ses ${(p.audioBitrate / 1000) | 0}kbps · Kamera ${(p.cameraBitrate / 1e6).toFixed(1)}Mbps · Ekran ${(p.screenBitrate / 1e6).toFixed(1)}Mbps @${p.screenFps}fps`;
}
function syncSettingsUI() {
  document.querySelectorAll('input[name="voice-mode"]').forEach((r) => { r.checked = r.value === appState.mode; });
  $('ptt-key-display').textContent = window.Store.get('pttKeyLabel') || window.Store.get('pttKey');
  $('chk-activity-enabled').checked = !!window.Store.get('activityEnabled');
  syncVoiceTuneLabels();
}

function fillProfileSettings() {
  $('profile-error').textContent = '';
  $('profile-username').value = appState.me?.username || '';
  $('profile-color').value = appState.me?.avatarColor || '#5865f2';
  $('profile-image-input').value = '';
  profileDraftImage = appState.me?.avatarImage || null;
  updateProfilePreview();
}

$('profile-color').addEventListener('input', () => {
  updateProfilePreview();
});
$('btn-upload-profile-image').addEventListener('click', () => $('profile-image-input').click());
$('btn-remove-profile-image').addEventListener('click', () => {
  profileDraftImage = null;
  $('profile-image-input').value = '';
  updateProfilePreview();
});
$('profile-image-input').addEventListener('change', async (e) => {
  $('profile-error').textContent = '';
  try {
    profileDraftImage = await imageFileToDataUrl(e.target.files?.[0], 320);
    updateProfilePreview();
  } catch (err) {
    $('profile-error').textContent = err.message;
  } finally {
    e.target.value = '';
  }
});

$('btn-save-profile').addEventListener('click', async () => {
  $('profile-error').textContent = '';
  $('btn-save-profile').disabled = true;
  try {
    const { token, user } = await window.Api.updateMe($('profile-username').value.trim(), $('profile-color').value, profileDraftImage);
    window.Store.set('token', token);
    appState.me = cacheUser(user);
    updateCachedMember(user);
    $('up-name').textContent = user.username;
    renderAvatar($('up-avatar'), user);
    fillProfileSettings();
    renderMemberSidebar();
    renderChannelList();
    if (appState.currentTextChannelId) renderMessages(appState.currentTextChannelId);
  } catch (e) {
    $('profile-error').textContent = e.message;
  } finally {
    $('btn-save-profile').disabled = false;
  }
});

$('sel-mic').addEventListener('change', async (e) => { window.Store.set('micId', e.target.value); if (appState.voice.connected) { await media.startMic(e.target.value); applyMicEnabled(); await mesh.updateTrack('mic'); startVAD(media.micStream, appState.me.id); } });
$('sel-speaker').addEventListener('change', async (e) => { window.Store.set('speakerId', e.target.value); media.setOutputDevice(e.target.value); for (const a of appState.voice.audioEls.values()) await media.applySinkId(a); });
$('sel-camera').addEventListener('change', async (e) => { window.Store.set('cameraId', e.target.value); if (appState.voice.camOn) { const profile = window.CONFIG.qualityProfiles[window.Store.get('profileKey')]; await media.startCamera(e.target.value, profile.cameraHeight); await mesh.updateTrack('camera'); showVideoOnTile(appState.me.id, media.cameraTrack); } });
$('sel-profile').addEventListener('change', async (e) => { window.Store.set('profileKey', e.target.value); updateProfileHint(); if (appState.voice.connected) await mesh.setProfile(window.CONFIG.qualityProfiles[e.target.value]); });
$('range-input-gain').addEventListener('input', (e) => {
  const value = clampNumber(e.target.value, -20, 20, 0);
  window.Store.set('inputGainDb', value);
  media.setInputGainDb(value);
  syncVoiceTuneLabels();
});
$('range-vad-threshold').addEventListener('input', (e) => {
  window.Store.set('vadThresholdDb', clampNumber(e.target.value, -80, -20, -55));
  syncVoiceTuneLabels();
});
$('range-output-volume').addEventListener('input', (e) => {
  window.Store.set('outputVolume', clampNumber(e.target.value, 0, 200, 100) / 100);
  applyOutputVolume();
  syncVoiceTuneLabels();
});
$('chk-activity-enabled').addEventListener('change', (e) => { window.Store.set('activityEnabled', e.target.checked); publishDesktopActivity(true); });
document.querySelectorAll('input[name="voice-mode"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { appState.mode = r.value; window.Store.set('voiceMode', r.value); applyModeUI(); if (appState.voice.connected) { applyMicEnabled(); if (r.value === 'ptt') startPTTIfNeeded(); else stopPTT(); } } }));

function applyModeUI() { /* ileride mod rozetleri vb. */ }

// =============================================================
//  Push-to-talk (global kısayol — preload üzerinden)
// =============================================================
$('btn-rebind-ptt').addEventListener('click', () => {
  const disp = $('ptt-key-display');
  disp.classList.add('listening'); disp.textContent = 'Bir tuşa bas…';
  const handler = (e) => {
    e.preventDefault();
    const key = e.code;
    const label = prettyKey(e);
    window.Store.update({ pttKey: key, pttKeyLabel: label });
    appState.pttKey = key;
    disp.classList.remove('listening'); disp.textContent = label;
    window.removeEventListener('keydown', handler, true);
    if (appState.voice.connected && appState.mode === 'ptt') startPTTIfNeeded();
  };
  window.addEventListener('keydown', handler, true);
});
function prettyKey(e) {
  if (e.code === 'Space') return 'Space';
  if (e.code.startsWith('Key')) return e.code.slice(3);
  if (e.code.startsWith('Digit')) return e.code.slice(5);
  return e.key.length === 1 ? e.key.toUpperCase() : e.code;
}

// Global PTT: main süreçteki dinleyiciyi kullan (oyun açıkken bile çalışır).
function startPTTIfNeeded() {
  if (appState.mode !== 'ptt' || !appState.voice.connected) return;
  if (window.ptt && window.ptt.start) {
    window.ptt.start(appState.pttKey);
  } else {
    enableInAppPTT(); // yedek: sadece uygulama odaktayken
  }
}
function stopPTT() {
  appState.pttActive = false;
  if (window.ptt && window.ptt.stop) window.ptt.stop();
  disableInAppPTT();
}
function onPTTDown() { if (!appState.pttActive) { appState.pttActive = true; applyMicEnabled(); } }
function onPTTUp() { if (appState.pttActive) { appState.pttActive = false; applyMicEnabled(); } }

if (window.ptt && window.ptt.onChange) {
  window.ptt.onChange((active) => { active ? onPTTDown() : onPTTUp(); });
}

// Yedek: uygulama odaktayken keydown/keyup
let inAppPTT = false;
function enableInAppPTT() {
  if (inAppPTT) return; inAppPTT = true;
  window.addEventListener('keydown', inAppKeyDown, true);
  window.addEventListener('keyup', inAppKeyUp, true);
}
function disableInAppPTT() { if (!inAppPTT) return; inAppPTT = false; window.removeEventListener('keydown', inAppKeyDown, true); window.removeEventListener('keyup', inAppKeyUp, true); }
function inAppKeyDown(e) { if (e.code === appState.pttKey && !e.repeat) onPTTDown(); }
function inAppKeyUp(e) { if (e.code === appState.pttKey) onPTTUp(); }
