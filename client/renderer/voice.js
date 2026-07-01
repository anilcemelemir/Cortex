// =============================================================
//  Ses Mesh'i (P2P / WebRTC)
// =============================================================
//  Bir ses kanalındaki her kullanıcı ile AYRI RTCPeerConnection
//  kurar (mesh). Medya doğrudan akar → sunucu hop'u yok → en düşük
//  gecikme. Signaling realtime gateway üzerinden gider.
//
//  peerId = userId. Sabit 3 transceiver (mic, kamera, ekran)
//  replaceTrack ile aç/kapatılır → tekrar renegotiation gerekmez.
// =============================================================

class VoiceMesh {
  constructor(media) {
    this.media = media;
    this.myUserId = null;
    this.channelId = null;
    // Ekran paylaşımı kodlayıcı parametreleri (paylaşım başlatılırken güncellenir).
    // maxBitrate = seçilen çözünürlük/fps'ten türetilir; degradationPreference
    // 'maintain-resolution' (Net) varsayılan — yük altında fps düşer, çözünürlük korunur.
    this.screenParams = {
      maxBitrate: window.CONFIG.screenBitrate(1080, 30),
      degradationPreference: 'maintain-resolution',
    };
    this.peers = new Map(); // userId -> PeerConn

    // Dışa olaylar
    this.onRemoteTrack = () => {};      // (userId, type, track, stream)
    this.onRemoteTrackEnded = () => {}; // (userId, type)
    this.onStats = () => {};            // (userId, { rttMs })
    this.onConnectionState = () => {};  // (userId, state)

    this._bindGateway();
  }

  _bindGateway() {
    const g = window.gateway;
    g.on('voice-joined', ({ channelId, peers }) => {
      if (channelId !== this.channelId) return;
      // Mevcut kişilere BEN bağlantı başlatırım (initiator)
      for (const p of peers) {
        const old = this.peers.get(p.userId);
        if (old) old.close();
        const peer = this._createPeer(p.userId, /*initiator*/ true);
        peer.start().catch((e) => console.warn('peer baslatilamadi', e));
      }
    });
    g.on('voice-peer-joined', ({ channelId, userId }) => {
      if (channelId !== this.channelId) return;
      // Eski/stale bir bağlantı kalmışsa (peer kapatıp tekrar açmışsa) onu
      // kapat ve sıfırdan kur — aksi halde yeniden katılan kişi sessiz kalır.
      const old = this.peers.get(userId);
      if (old) { old.close(); this.peers.delete(userId); }
      // Yeni gelen bana bağlanacak; ben non-initiator bekliyorum
      const peer = this._createPeer(userId, /*initiator*/ false);
      peer.start().catch((e) => console.warn('peer baslatilamadi', e));
    });
    g.on('voice-peer-left', ({ channelId, userId }) => {
      if (channelId !== this.channelId) return;
      const peer = this.peers.get(userId);
      if (peer) peer.close();
      this.peers.delete(userId);
    });
    g.on('signal', ({ fromUserId, signal }) => {
      const peer = this.peers.get(fromUserId);
      if (peer) peer.handleSignal(signal);
    });
  }

  async join(channelId) {
    this.myUserId = window.appState.me.id;
    this.channelId = channelId;
    window.gateway.send({ type: 'join-voice', channelId });
  }

  leave() {
    window.gateway.send({ type: 'leave-voice' });
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.channelId = null;
  }

  // Yerel peer'leri kapat ama kanalda kalmaya devam et (sunucuya leave gönderme).
  // WS reconnect sonrası ölü peer'leri temizleyip yeniden katılmak için kullanılır.
  resetPeers() {
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
  }

  _sendSignal(targetUserId, signal) {
    window.gateway.send({ type: 'signal', targetUserId, signal });
  }

  _createPeer(userId, initiator) {
    const peer = new PeerConn(this, userId, initiator);
    this.peers.set(userId, peer);
    return peer;
  }

  async updateTrack(type) {
    for (const peer of this.peers.values()) await peer.applyTrack(type);
  }

  broadcastState(state) {
    window.gateway.send({ type: 'voice-state', state });
  }

  // Ekran paylaşımı parametrelerini güncelle (paylaşım başlatılırken çağrılır):
  // { maxBitrate, degradationPreference }. Tüm aktif peer'lere uygula.
  async setScreenParams(params) {
    this.screenParams = { ...this.screenParams, ...params };
    for (const peer of this.peers.values()) await peer.applyBitrates();
  }
}

// =============================================================
//  Tek bir peer ile bağlantı
// =============================================================
class PeerConn {
  constructor(mesh, userId, initiator) {
    this.mesh = mesh;
    this.userId = userId;
    this.initiator = initiator;

    // Perfect negotiation rolleri
    this.polite = !initiator;
    this.makingOffer = false;
    this.ignoreOffer = false;

    this.pc = new RTCPeerConnection({ iceServers: window.CONFIG.iceServers });

    this.tx = {
      mic: this.pc.addTransceiver('audio', { direction: 'sendrecv' }),
      camera: this.pc.addTransceiver('video', { direction: 'sendrecv' }),
      screen: this.pc.addTransceiver('video', { direction: 'sendrecv' }),
      screenAudio: this.pc.addTransceiver('audio', { direction: 'sendrecv' }),
    };

    this.remoteTrackMap = {};
    this.pendingTracks = [];

    this._setupPeerEvents();
    this._setupDataChannel();
  }

  _setupPeerEvents() {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.mesh._sendSignal(this.userId, { candidate });
    };

    this.pc.onnegotiationneeded = async () => {
      if (!this.initiator) return;
      try {
        this.makingOffer = true;
        let offer = await this.pc.createOffer();
        offer = { type: offer.type, sdp: mungeOpus(offer.sdp, window.CONFIG.media.audioBitrate) };
        await this.pc.setLocalDescription(offer);
        this.mesh._sendSignal(this.userId, { sdp: this.pc.localDescription });
      } catch (e) {
        console.error('negotiation hatası', e);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.ontrack = (ev) => {
      const mid = ev.transceiver.mid;
      const type = this._typeForTransceiver(ev.transceiver) || this.remoteTrackMap[mid];
      if (type) this._emitRemoteTrack(type, ev.track, ev.streams[0]);
      else this.pendingTracks.push({ mid, transceiver: ev.transceiver, track: ev.track, stream: ev.streams[0] });

      ev.track.onended = () => {
        const t = this._typeForTransceiver(ev.transceiver) || this.remoteTrackMap[mid];
        if (t) this.mesh.onRemoteTrackEnded(this.userId, t);
      };
    };

    this.pc.onconnectionstatechange = () => {
      this.mesh.onConnectionState(this.userId, this.pc.connectionState);
    };

    this.statsTimer = setInterval(() => this._collectStats(), 2000);
  }

  _setupDataChannel() {
    if (this.initiator) {
      this.dc = this.pc.createDataChannel('meta');
      this._wireDataChannel();
    } else {
      this.pc.ondatachannel = (ev) => { this.dc = ev.channel; this._wireDataChannel(); };
    }
  }

  _wireDataChannel() {
    this.dc.onopen = () => this._sendTrackMap();
    if (this.dc.readyState === 'open') queueMicrotask(() => this._sendTrackMap());
    this.dc.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'track-map') {
        this.remoteTrackMap = msg.map;
        const still = [];
        for (const p of this.pendingTracks) {
          const t = this._typeForTransceiver(p.transceiver) || this.remoteTrackMap[p.mid];
          if (t) this._emitRemoteTrack(t, p.track, p.stream);
          else still.push(p);
        }
        this.pendingTracks = still;
      }
    };
  }

  _typeForTransceiver(transceiver) {
    if (!transceiver) return null;
    for (const [type, tx] of Object.entries(this.tx)) {
      if (tx === transceiver || (tx.mid && tx.mid === transceiver.mid)) return type;
    }
    return null;
  }

  _sendTrackMap() {
    if (!this.dc || this.dc.readyState !== 'open') return;
    const map = {};
    if (this.tx.mic.mid) map[this.tx.mic.mid] = 'mic';
    if (this.tx.camera.mid) map[this.tx.camera.mid] = 'camera';
    if (this.tx.screen.mid) map[this.tx.screen.mid] = 'screen';
    if (this.tx.screenAudio.mid) map[this.tx.screenAudio.mid] = 'screenAudio';
    this.dc.send(JSON.stringify({ type: 'track-map', map }));
  }

  _emitRemoteTrack(type, track, stream) {
    this.mesh.onRemoteTrack(this.userId, type, track, stream);
  }

  async start() {
    await this.applyTrack('mic');
    await this.applyTrack('camera');
    await this.applyTrack('screen');
    await this.applyTrack('screenAudio');
    await this.applyBitrates();
  }

  async applyTrack(type) {
    const media = this.mesh.media;
    let track = null;
    if (type === 'mic') track = media.micTrack;
    else if (type === 'camera') track = media.cameraTrack;
    else if (type === 'screen') track = media.screenTrack;
    else if (type === 'screenAudio') track = media.screenAudioTrack;

    const tx = this.tx[type];
    if (!tx) return;
    try { await tx.sender.replaceTrack(track); }
    catch (e) { console.warn(`replaceTrack(${type}) hatası`, e); }
    await this.applyBitrates();
    this._sendTrackMap();
  }

  async applyBitrates() {
    const media = window.CONFIG.media;
    const screen = this.mesh.screenParams;
    // Ses (mic ve sistem sesi) bant genişliğinde önceliklidir: ekran yayını
    // upload'ı doyursa bile ses paketleri öne alınır → robotik/"derin" ses olmaz.
    await this._setBitrate(this.tx.mic.sender, media.audioBitrate, { priority: 'high' });
    await this._setBitrate(this.tx.screenAudio.sender, media.audioBitrate, { priority: 'high' });
    await this._setBitrate(this.tx.camera.sender, media.cameraBitrate);
    // Ekran: bitrate seçilen çözünürlük/fps'ten türetilir; degradationPreference
    // kullanıcının Net/Akıcı seçimine göre gelir. Düşük öncelik → sesi ezmez.
    await this._setBitrate(this.tx.screen.sender, screen.maxBitrate, {
      degradationPreference: screen.degradationPreference,
      priority: 'low',
    });
  }

  async _setBitrate(sender, maxBitrate, opts = {}) {
    if (!sender) return;
    const { degradationPreference, priority } = opts;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = maxBitrate;
    if (priority) {
      params.encodings[0].priority = priority;
      params.encodings[0].networkPriority = priority;
    }
    if (degradationPreference) params.degradationPreference = degradationPreference;
    try { await sender.setParameters(params); } catch (e) {}
  }

  async handleSignal(signal) {
    try {
      if (signal.sdp) {
        const offerCollision =
          signal.sdp.type === 'offer' &&
          (this.makingOffer || this.pc.signalingState !== 'stable');

        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;

        let desc = signal.sdp;
        if (desc.type === 'offer' || desc.type === 'answer') {
          desc = { type: desc.type, sdp: mungeOpus(desc.sdp, window.CONFIG.media.audioBitrate) };
        }
        await this.pc.setRemoteDescription(desc);

        if (signal.sdp.type === 'offer') {
          let answer = await this.pc.createAnswer();
          answer = { type: answer.type, sdp: mungeOpus(answer.sdp, window.CONFIG.media.audioBitrate) };
          await this.pc.setLocalDescription(answer);
          this.mesh._sendSignal(this.userId, { sdp: this.pc.localDescription });
        }
      } else if (signal.candidate) {
        try { await this.pc.addIceCandidate(signal.candidate); }
        catch (e) { if (!this.ignoreOffer) throw e; }
      }
    } catch (e) {
      console.error('handleSignal hatası', e);
    }
  }

  async _collectStats() {
    if (this.pc.connectionState !== 'connected') return;
    try {
      const stats = await this.pc.getStats();
      let rttMs = null;
      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
          if (typeof report.currentRoundTripTime === 'number') {
            rttMs = Math.round(report.currentRoundTripTime * 1000);
          }
        }
      });
      if (rttMs !== null) this.mesh.onStats(this.userId, { rttMs });
    } catch (e) {}
  }

  close() {
    clearInterval(this.statsTimer);
    if (this.dc) try { this.dc.close(); } catch {}
    try { this.pc.close(); } catch {}
  }
}

// =============================================================
//  Opus SDP optimizasyonu (düşük gecikme + paket kaybı dayanıklılığı)
// =============================================================
function mungeOpus(sdp, audioBitrate) {
  if (!sdp) return sdp;
  const lines = sdp.split('\r\n');

  let opusPayload = null;
  for (const line of lines) {
    const m = line.match(/^a=rtpmap:(\d+) opus\/48000/);
    if (m) { opusPayload = m[1]; break; }
  }
  if (!opusPayload) return sdp;

  const desired = { useinbandfec: '1', usedtx: '1', maxaveragebitrate: String(audioBitrate) };

  let fmtpIndex = lines.findIndex((l) => l.startsWith(`a=fmtp:${opusPayload}`));
  if (fmtpIndex !== -1) {
    const prefix = `a=fmtp:${opusPayload} `;
    const existing = lines[fmtpIndex].slice(prefix.length);
    const params = {};
    for (const part of existing.split(';')) {
      const [k, v] = part.split('=');
      if (k) params[k.trim()] = v;
    }
    Object.assign(params, desired);
    lines[fmtpIndex] = prefix + Object.entries(params)
      .map(([k, v]) => (v === undefined ? k : `${k}=${v}`)).join(';');
  } else {
    const rtpIndex = lines.findIndex((l) => l.startsWith(`a=rtpmap:${opusPayload} opus`));
    const params = Object.entries(desired).map(([k, v]) => `${k}=${v}`).join(';');
    if (rtpIndex !== -1) lines.splice(rtpIndex + 1, 0, `a=fmtp:${opusPayload} ${params}`);
  }
  return lines.join('\r\n');
}

window.VoiceMesh = VoiceMesh;
