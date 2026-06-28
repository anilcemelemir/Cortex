// =============================================================
//  Mesh Yöneticisi (P2P)
// =============================================================
//  Odadaki her peer ile AYRI bir RTCPeerConnection kurar (mesh).
//  Medya doğrudan peer'ler arasında akar -> sunucu hop'u yok ->
//  en düşük gecikme.
//
//  Her bağlantıda sabit 3 transceiver vardır (mic, kamera, ekran).
//  Bunları replaceTrack ile aç/kapat yaparız -> tekrar tekrar
//  renegotiation gerekmez -> bağlantı stabil ve düşük gecikmeli.
// =============================================================

class MeshManager {
  constructor(media) {
    this.media = media;            // MediaManager örneği
    this.ws = null;
    this.myPeerId = null;
    this.peers = new Map();        // peerId -> PeerConn

    this.profile = null;           // aktif kalite profili

    // Dışarıya event'ler
    this.onPeerJoined = () => {};
    this.onPeerLeft = () => {};
    this.onRemoteTrack = () => {};     // (peerId, type, track, stream)
    this.onRemoteTrackEnded = () => {};// (peerId, type)
    this.onPeerState = () => {};       // (peerId, state)
    this.onSelfJoined = () => {};      // (peerId)
    this.onStats = () => {};           // (peerId, { rttMs })
    this.onConnectionState = () => {}; // (peerId, state)
  }

  connect(signalingUrl, roomId, displayName, profile) {
    this.profile = profile;
    this.ws = new WebSocket(signalingUrl);

    this.ws.onopen = () => {
      this._sendSignal({ type: 'join', roomId, displayName });
    };

    this.ws.onmessage = (ev) => this._handleSignaling(JSON.parse(ev.data));

    this.ws.onclose = () => console.warn('Signaling bağlantısı kapandı');
    this.ws.onerror = (e) => console.error('Signaling hatası', e);
  }

  disconnect() {
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    if (this.ws) this.ws.close();
  }

  _sendSignal(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  async _handleSignaling(msg) {
    switch (msg.type) {
      case 'joined': {
        this.myPeerId = msg.peerId;
        this.onSelfJoined(msg.peerId);
        // Odadaki mevcut peer'lere BEN bağlantı başlatırım (initiator)
        for (const p of msg.peers) {
          this.onPeerJoined(p.peerId, p.displayName);
          const peer = this._createPeer(p.peerId, p.displayName, /*initiator*/ true);
          await peer.start();
        }
        break;
      }
      case 'peer-joined': {
        // Yeni gelen peer BANA bağlanacak; ben sadece bekliyorum.
        this.onPeerJoined(msg.peerId, msg.displayName);
        this._createPeer(msg.peerId, msg.displayName, /*initiator*/ false);
        break;
      }
      case 'peer-left': {
        const peer = this.peers.get(msg.peerId);
        if (peer) peer.close();
        this.peers.delete(msg.peerId);
        this.onPeerLeft(msg.peerId);
        break;
      }
      case 'signal': {
        const peer = this.peers.get(msg.fromPeerId);
        if (peer) await peer.handleSignal(msg.signal);
        break;
      }
      case 'peer-state': {
        this.onPeerState(msg.peerId, msg.state);
        break;
      }
    }
  }

  _createPeer(peerId, displayName, initiator) {
    const peer = new PeerConn(this, peerId, displayName, initiator);
    this.peers.set(peerId, peer);
    return peer;
  }

  // --- Tüm peer'lerde belirli bir track tipini değiştir ---
  async updateTrack(type) {
    for (const peer of this.peers.values()) {
      await peer.applyTrack(type);
    }
  }

  // --- Durum yayını (mute/cam/screen) ---
  broadcastState(state) {
    this._sendSignal({ type: 'state', state });
  }

  // --- Kalite profili değiştir, bitrate'leri güncelle ---
  async setProfile(profile) {
    this.profile = profile;
    for (const peer of this.peers.values()) {
      await peer.applyBitrates();
    }
  }
}

// =============================================================
//  Tek bir peer ile bağlantı
// =============================================================
class PeerConn {
  constructor(mesh, peerId, displayName, initiator) {
    this.mesh = mesh;
    this.peerId = peerId;
    this.displayName = displayName;
    this.initiator = initiator;

    // Perfect negotiation rolleri
    this.polite = mesh.myPeerId < peerId;
    this.makingOffer = false;
    this.ignoreOffer = false;

    this.pc = new RTCPeerConnection({ iceServers: window.CONFIG.iceServers });

    // Sabit gönderim transceiver'ları (mic, kamera, ekran)
    this.tx = {
      mic: this.pc.addTransceiver('audio', { direction: 'sendrecv' }),
      camera: this.pc.addTransceiver('video', { direction: 'sendrecv' }),
      screen: this.pc.addTransceiver('video', { direction: 'sendrecv' }),
    };

    // mid -> tip eşlemesi (karşı tarafın gelen track'lerini tanımak için)
    this.remoteTrackMap = {};
    this.pendingTracks = []; // metadata gelmeden önce gelen track'ler

    this._setupPeerEvents();
    this._setupDataChannel();
  }

  _setupPeerEvents() {
    // ICE adaylarını karşıya ilet
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.mesh._sendSignal({
          type: 'signal',
          targetPeerId: this.peerId,
          signal: { candidate },
        });
      }
    };

    // Renegotiation gerektiğinde (perfect negotiation)
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        let offer = await this.pc.createOffer();
        offer = { type: offer.type, sdp: mungeOpus(offer.sdp, this.mesh.profile.audioBitrate) };
        await this.pc.setLocalDescription(offer);
        this.mesh._sendSignal({
          type: 'signal',
          targetPeerId: this.peerId,
          signal: { sdp: this.pc.localDescription },
        });
      } catch (e) {
        console.error('negotiation hatası', e);
      } finally {
        this.makingOffer = false;
      }
    };

    // Gelen uzak track'ler
    this.pc.ontrack = (ev) => {
      const mid = ev.transceiver.mid;
      const type = this.remoteTrackMap[mid];
      if (type) {
        this._emitRemoteTrack(type, ev.track, ev.streams[0]);
      } else {
        this.pendingTracks.push({ mid, track: ev.track, stream: ev.streams[0] });
      }
      // Track bittiğinde haber ver
      ev.track.onended = () => {
        const t = this.remoteTrackMap[mid];
        if (t) this.mesh.onRemoteTrackEnded(this.peerId, t);
      };
    };

    this.pc.onconnectionstatechange = () => {
      this.mesh.onConnectionState(this.peerId, this.pc.connectionState);
    };

    // Periyodik ping (RTT) ölçümü
    this.statsTimer = setInterval(() => this._collectStats(), 2000);
  }

  _setupDataChannel() {
    // Çift kanal olmaması için: ID'si büyük olan oluşturur, diğeri dinler.
    const iCreate = this.mesh.myPeerId > this.peerId;
    if (iCreate) {
      this.dc = this.pc.createDataChannel('meta');
      this._wireDataChannel();
    } else {
      this.pc.ondatachannel = (ev) => {
        this.dc = ev.channel;
        this._wireDataChannel();
      };
    }
  }

  _wireDataChannel() {
    this.dc.onopen = () => this._sendTrackMap();
    this.dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'track-map') {
        this.remoteTrackMap = msg.map;
        // Bekleyen track'leri şimdi çöz
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
    this.mesh.onRemoteTrack(this.peerId, type, track, stream);
  }

  // İlk bağlantı (initiator ise mevcut track'leri ekleyip offer atar)
  async start() {
    // Mevcut yerel track'leri transceiver'lara yerleştir
    await this.applyTrack('mic');
    await this.applyTrack('camera');
    await this.applyTrack('screen');
    await this.applyBitrates();
    // onnegotiationneeded zaten tetiklenir; ek offer'a gerek yok.
  }

  // Belirli bir track tipini güncelle (aç/kapat) - renegotiation gerektirmez
  async applyTrack(type) {
    const media = this.mesh.media;
    let track = null;
    if (type === 'mic') track = media.micTrack;
    else if (type === 'camera') track = media.cameraTrack;
    else if (type === 'screen') track = media.screenTrack;

    const tx = this.tx[type];
    if (!tx) return;
    try {
      await tx.sender.replaceTrack(track); // null -> kapalı
    } catch (e) {
      console.warn(`replaceTrack(${type}) hatası`, e);
    }
    await this.applyBitrates();
    this._sendTrackMap();
  }

  // Bitrate tavanlarını uygula (ping-dostu)
  async applyBitrates() {
    const p = this.mesh.profile;
    await this._setBitrate(this.tx.mic.sender, p.audioBitrate);
    await this._setBitrate(this.tx.camera.sender, p.cameraBitrate);
    await this._setBitrate(this.tx.screen.sender, p.screenBitrate);
  }

  async _setBitrate(sender, maxBitrate) {
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = maxBitrate;
    try {
      await sender.setParameters(params);
    } catch (e) {
      // bazı durumlarda track yokken hata verebilir, yok sayılır
    }
  }

  // Perfect negotiation: gelen offer/answer/ice'ı işle
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
          this.mesh._sendSignal({
            type: 'signal',
            targetPeerId: this.peerId,
            signal: { sdp: this.pc.localDescription },
          });
        }
      } else if (signal.candidate) {
        try {
          await this.pc.addIceCandidate(signal.candidate);
        } catch (e) {
          if (!this.ignoreOffer) throw e;
        }
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
      if (rttMs !== null) this.mesh.onStats(this.peerId, { rttMs });
    } catch (e) {
      /* yok say */
    }
  }

  close() {
    clearInterval(this.statsTimer);
    if (this.dc) try { this.dc.close(); } catch {}
    try { this.pc.close(); } catch {}
  }
}

// =============================================================
//  Opus SDP optimizasyonu
// =============================================================
//  Opus codec'ine düşük gecikme + paket kaybı dayanıklılığı ekler:
//   - useinbandfec=1 : paket kaybında düzeltme (kalite korunur)
//   - usedtx=1       : sessizlikte veri göndermez (bant tasarrufu)
//   - maxaveragebitrate : ses bitrate tavanı
// =============================================================
function mungeOpus(sdp, audioBitrate) {
  if (!sdp) return sdp;
  const lines = sdp.split('\r\n');

  // Opus payload tipini bul
  let opusPayload = null;
  for (const line of lines) {
    const m = line.match(/^a=rtpmap:(\d+) opus\/48000/);
    if (m) { opusPayload = m[1]; break; }
  }
  if (!opusPayload) return sdp;

  // Uygulamak istediğimiz parametreler (mevcutları ezerek)
  const desired = {
    useinbandfec: '1',   // paket kaybı düzeltme
    usedtx: '1',         // sessizlikte gönderme (bant tasarrufu)
    maxaveragebitrate: String(audioBitrate),
  };

  // fmtp satırı varsa parametrelerini birleştir, yoksa oluştur
  let fmtpIndex = lines.findIndex((l) => l.startsWith(`a=fmtp:${opusPayload}`));

  if (fmtpIndex !== -1) {
    // Mevcut "a=fmtp:111 k=v;k2=v2" satırını ayrıştır
    const prefix = `a=fmtp:${opusPayload} `;
    const existing = lines[fmtpIndex].slice(prefix.length);
    const params = {};
    for (const part of existing.split(';')) {
      const [k, v] = part.split('=');
      if (k) params[k.trim()] = v;
    }
    // İstediklerimizle ez/ekle
    Object.assign(params, desired);
    const merged = Object.entries(params)
      .map(([k, v]) => (v === undefined ? k : `${k}=${v}`))
      .join(';');
    lines[fmtpIndex] = prefix + merged;
  } else {
    // fmtp yoksa rtpmap'ten hemen sonra oluştur
    const rtpIndex = lines.findIndex((l) => l.startsWith(`a=rtpmap:${opusPayload} opus`));
    const params = Object.entries(desired).map(([k, v]) => `${k}=${v}`).join(';');
    if (rtpIndex !== -1) lines.splice(rtpIndex + 1, 0, `a=fmtp:${opusPayload} ${params}`);
  }

  return lines.join('\r\n');
}

window.MeshManager = MeshManager;
