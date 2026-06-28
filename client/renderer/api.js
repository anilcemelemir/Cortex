// =============================================================
//  REST İstemcisi
// =============================================================
//  Sunucunun HTTP API'sine token'lı istek atan ince sarmalayıcı.
// =============================================================

window.Api = {
  base() {
    const server = window.CONFIG.allowCustomServer ? window.Store.get('serverUrl') : window.CONFIG.defaultServer;
    return window.serverUrls(server).api;
  },

  async request(method, path, body, withAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (withAuth) {
      const token = window.Store.get('token');
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let res;
    try {
      res = await fetch(this.base() + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error('Sunucuya ulaşılamadı (' + this.base() + ')');
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      throw new Error((data && data.error) || `Hata ${res.status}`);
    }
    return data;
  },
  fileUrl(attachment) {
    const base = this.base();
    const root = base.endsWith('/api') ? base.slice(0, -4) : base;
    return `${root}/api/files/${encodeURIComponent(attachment.storedName)}/${encodeURIComponent(attachment.name || 'dosya')}`;
  },

  // --- Auth ---
  register: (username, password) => Api.request('POST', '/auth/register', { username, password }, false),
  login: (username, password) => Api.request('POST', '/auth/login', { username, password }, false),
  me: () => Api.request('GET', '/auth/me'),
  updateMe: (username, avatarColor, avatarImage) => Api.request('PATCH', '/auth/me', { username, avatarColor, avatarImage }),

  // --- Guild ---
  listGuilds: () => Api.request('GET', '/guilds'),
  createGuild: (name) => Api.request('POST', '/guilds', { name }),
  joinGuild: (inviteCode) => Api.request('POST', '/guilds/join', { inviteCode }),
  updateGuild: (id, name, iconImage) => Api.request('PATCH', `/guilds/${id}`, { name, iconImage }),
  leaveGuild: (id) => Api.request('POST', `/guilds/${id}/leave`),
  deleteGuild: (id) => Api.request('DELETE', `/guilds/${id}`),

  // --- Channel ---
  createChannel: (guildId, name, type) => Api.request('POST', `/guilds/${guildId}/channels`, { name, type }),
  deleteChannel: (id) => Api.request('DELETE', `/channels/${id}`),
  renameChannel: (id, name) => Api.request('PATCH', `/channels/${id}`, { name }),

  // --- Messages ---
  uploadFile: (channelId, file) => Api.request('POST', `/channels/${channelId}/files`, file),
  messages: (channelId, before) =>
    Api.request('GET', `/channels/${channelId}/messages${before ? `?before=${before}` : ''}`),
};
