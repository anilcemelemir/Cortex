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
    this.profile = null;
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
        const peer = this._createPeer(p.userId, /*initiator*/ true);
        peer.start();
      }
    });
    g.on('voice-peer-joined', ({ channelId, userId }) => {
      if (channelId !== this.channelId) return;
      if (this.peers.has(userId)) return;
      // Yeni gelen bana bağlanacak; ben non-initiator bekliyorum
      this._createPeer(userId, /*initiator*/ false);
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

  async join(channelId, profile) {
    this.myUserId = window.appState.me.id;
    this.channelId = channelId;
    this.profile = profile;
    window.gateway.send({ type: 'join-voice', channelId });
  }

  leave() {
    window.gateway.send({ type: 'leave-voice' });
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    this.channelId = null;
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

  async setProfile(profile) {
    this.profile = profile;
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
    this.polite = mesh.myUserId < userId;
    this.makingOffer = false;
    this.ignoreOffer = false;

    this.pc = new RTCPeerConnection({ iceServers: window.CONFIG.iceServers });

    this.tx = {
      mic: this.pc.addTransceiver('audio', { direction: 'sendrecv' }),
      camera: this.pc.addTransceiver('video', { direction: 'sendrecv' }),
      screen: this.pc.addTransceiver('video', { direction: 'sendrecv' }),
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
      try {
        this.makingOffer = true;
        let offer = await this.pc.createOffer();
        offer = { type: offer.type, sdp: mungeOpus(offer.sdp, this.mesh.profile.audioBitrate) };
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
      const type = this.remoteTrackMap[mid];
      if (type) this._emitRemoteTrack(type, ev.track, ev.streams[0]);
      else this.pendingTracks.push({ mid, track: ev.track, stream: ev.streams[0] });

      ev.track.onended = () => {
        const t = this.remoteTrackMap[mid];
        if (t) this.mesh.onRemoteTrackEnded(this.userId, t);
      };
    };

    this.pc.onconnectionstatechange = () => {
      this.mesh.onConnectionState(this.userId, this.pc.connectionState);
    };

    this.statsTimer = setInterval(() => this._collectStats(), 2000);
  }

  _setupDataChannel() {
    const iCreate = this.mesh.myUserId > this.userId;
    if (iCreate) {
      this.dc = this.pc.createDataChannel('meta');
      this._wireDataChannel();
    } else {
      this.pc.ondatachannel = (ev) => { this.dc = ev.channel; this._wireDataChannel(); };
    }
  }

  _wireDataChannel() {
    this.dc.onopen = () => this._sendTrackMap();
    this.dc.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'track-map') {
        this.remoteTrackMap = msg.map;
        const still = [];
        for (const p of this.pendingTracks) {
          const t = this.remoteTrackMap[p.mid];
          if (t) this._emitRemoteTrack(t, p.track, p.stream);
          else still.push(p);
        }
        this.pendingTracks = still;
      }
    };
  }

  _sendTrackMap() {
    if (!this.dc || this.dc.readyState !== 'open') return;
    const map = {};
    if (this.tx.mic.mid) map[this.tx.mic.mid] = 'mic';
    if (this.tx.camera.mid) map[this.tx.camera.mid] = 'camera';
    if (this.tx.screen.mid) map[this.tx.screen.mid] = 'screen';
    this.dc.send(JSON.stringify({ type: 'track-map', map }));
  }

  _emitRemoteTrack(type, track, stream) {
    this.mesh.onRemoteTrack(this.userId, type, track, stream);
  }

  async start() {
    await this.applyTrack('mic');
    await this.applyTrack('camera');
    await this.applyTrack('screen');
    await this.applyBitrates();
  }

  async applyTrack(type) {
    const media = this.mesh.media;
    let track = null;
    if (type === 'mic') track = media.micTrack;
    else if (type === 'camera') track = media.cameraTrack;
    else if (type === 'screen') track = media.screenTrack;

    const tx = this.tx[type];
    if (!tx) return;
    try { await tx.sender.replaceTrack(track); }
    catch (e) { console.warn(`replaceTrack(${type}) hatası`, e); }
    await this.applyBitrates();
    this._sendTrackMap();
  }

  async applyBitrates() {
    const p = this.mesh.profile;
    await this._setBitrate(this.tx.mic.sender, p.audioBitrate);
    await this._setBitrate(this.tx.camera.sender, p.cameraBitrate);
    await this._setBitrate(this.tx.screen.sender, p.screenBitrate);
  }

  async _setBitrate(sender, maxBitrate) {
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = maxBitrate;
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
          desc = { type: desc.type, sdp: mungeOpus(desc.sdp, this.mesh.profile.audioBitrate) };
        }
        await this.pc.setRemoteDescription(desc);

        if (signal.sdp.type === 'offer') {
          let answer = await this.pc.createAnswer();
          answer = { type: answer.type, sdp: mungeOpus(answer.sdp, this.mesh.profile.audioBitrate) };
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
