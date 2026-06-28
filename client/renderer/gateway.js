// =============================================================
//  Realtime Gateway (WebSocket istemcisi)
// =============================================================
//  Sunucuyla tek kalıcı bağlantı. İlk mesajda token ile kimlik
//  doğrular. Gelen olayları abonelere dağıtır (text, ses signaling,
//  presence). Bağlantı koparsa otomatik yeniden bağlanır.
// =============================================================

class Gateway {
  constructor() {
    this.ws = null;
    this.ready = false;
    this.shouldReconnect = false;
    this.reconnectDelay = 1000;
    this.listeners = new Map();   // type -> Set<cb>
    this.queue = [];              // bağlanana kadar bekleyen mesajlar
  }

  on(type, cb) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(cb);
    return () => this.listeners.get(type)?.delete(cb);
  }

  _emit(type, payload) {
    const set = this.listeners.get(type);
    if (set) for (const cb of set) { try { cb(payload); } catch (e) { console.error(e); } }
  }

  connect() {
    this.shouldReconnect = true;
    this._open();
  }

  _open() {
    const server = window.CONFIG.allowCustomServer ? window.Store.get('serverUrl') : window.CONFIG.defaultServer;
    const url = window.serverUrls(server).ws;
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.send({ type: 'auth', token: window.Store.get('token') });
    };

    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'ready') {
        this.ready = true;
        // Kuyruktaki mesajları gönder
        const q = this.queue; this.queue = [];
        for (const m of q) this.send(m);
      }
      this._emit(msg.type, msg);
      this._emit('*', msg);
    };

    this.ws.onclose = () => {
      this.ready = false;
      this._emit('disconnected', {});
      if (this.shouldReconnect) this._scheduleReconnect();
    };

    this.ws.onerror = () => { try { this.ws.close(); } catch {} };
  }

  _scheduleReconnect() {
    setTimeout(() => { if (this.shouldReconnect) this._open(); }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 10000);
  }

  // ready olmadan gönderilen (auth hariç) mesajları kuyruğa al
  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && (this.ready || obj.type === 'auth')) {
      this.ws.send(JSON.stringify(obj));
    } else {
      this.queue.push(obj);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.ready = false;
    if (this.ws) try { this.ws.close(); } catch {}
    this.ws = null;
    this.queue = [];
  }
}

window.gateway = new Gateway();
