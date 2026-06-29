// =============================================================
//  Yerel Medya Yöneticisi (MediaManager)
// =============================================================
//  Mikrofon, kamera ve ekran paylaşımı stream'lerini yönetir.
//  Cihaz seçimi (input/output/kamera) burada yapılır.
// =============================================================

class MediaManager {
  constructor() {
    this.micStream = null;       // MediaStream (audio)
    this.rawMicStream = null;    // getUserMedia'dan gelen ham mikrofon
    this.micAudioCtx = null;
    this.micGainNode = null;
    this.cameraStream = null;    // MediaStream (video - kamera)
    this.screenStream = null;    // MediaStream (video + opsiyonel audio - ekran)

    this.selectedMicId = null;
    this.selectedCameraId = null;
    this.selectedOutputId = null; // hoparlör (setSinkId ile uygulanır)

    // --- RNNoise (güçlü gürültü bastırma) ---
    this._rnnoiseWasm = null;          // ArrayBuffer (cache)
    this._rnnoiseModuleCtxs = new WeakSet(); // addModule yapılmış AudioContext'ler
    this.rnnoiseNode = null;           // aktif RNNoise worklet düğümü
    this.rnnoiseDisabled = false;      // yükleme başarısızsa bu oturumda tekrar deneme
    this.micMonitorStream = null;      // VAD/ölçer için kapıdan bağımsız temiz akış

    this.onLocalStreamChange = () => {};
  }

  // --- Sistem cihazlarını listele ---
  async enumerateDevices() {
    let devices = await navigator.mediaDevices.enumerateDevices();
    // Label'lar boşsa henüz izin yok → kısa bir izin alıp tekrar oku. İzin ZATEN
    // varsa varsayılan mikrofonu boşuna AÇMA: her ayar/cihaz-değişiminde default
    // mic'i açmak Windows'ta cihaz kaymasına/takırtısına yol açabiliyor.
    if (!devices.some((d) => d.label)) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch (e) {
        // izin reddedilirse yine de boş label'larla devam
      }
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    return {
      mics: devices.filter((d) => d.kind === 'audioinput'),
      speakers: devices.filter((d) => d.kind === 'audiooutput'),
      cameras: devices.filter((d) => d.kind === 'videoinput'),
    };
  }

  // --- Mikrofon ---
  async startMic(deviceId = this.selectedMicId) {
    this.stopMic();
    const wantNoiseSuppression = window.Store?.get('noiseSuppression') !== false;
    // Gürültü azaltma açıkken RNNoise (WebAudio worklet) bastırır → tarayıcının
    // kendi NS'ini KAPAT (çift işlem bozar). RNNoise yüklenemezse (rnnoiseDisabled)
    // tarayıcı NS'ine geri düşeriz: o zaman browserNs = kullanıcının tercihi.
    const useRnnoise = wantNoiseSuppression && !this.rnnoiseDisabled;
    const browserNs = wantNoiseSuppression && !useRnnoise;
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: browserNs,
        autoGainControl: true,
        // Düşük gecikme için kanal/örnekleme:
        channelCount: 1,
        sampleRate: 48000,
      },
      video: false,
    };
    // Kayıtlı cihaz id'si artık geçersizse (çıkarılmış / oturumlar arası değişmiş)
    // {exact} OverconstrainedError fırlatır → katılım çöker veya ses girişi
    // "saçma şekilde" kaybolur. Bu durumda varsayılan mikrofona düş.
    try {
      this.rawMicStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (deviceId && ['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(e.name)) {
        constraints.audio.deviceId = undefined;
        this.rawMicStream = await navigator.mediaDevices.getUserMedia(constraints);
        deviceId = null;
      } else throw e;
    }
    this.micStream = await this._buildMicGainStream(this.rawMicStream, useRnnoise);
    this.selectedMicId = deviceId || null;

    // RNNoise istendi ama bu derlemede yüklenemedi → şu an HİÇBİR gürültü bastırma
    // yok (tarayıcı NS'ini de kapatmıştık). Tek seferlik yeniden başlat: artık
    // rnnoiseDisabled=true olduğundan tarayıcı NS'ine düşeriz (sessizce kapanmaz).
    if (useRnnoise && this.rnnoiseDisabled) {
      return this.startMic(this.selectedMicId);
    }

    this.onLocalStreamChange();
    return this.micStream;
  }

  async _buildMicGainStream(rawStream, useRnnoise = false) {
    try {
      this.micAudioCtx = new AudioContext({ sampleRate: 48000 });
      // Chromium AudioContext'i bazen 'suspended' baslatir; resume edilmezse
      // MediaStreamDestination SESSIZ uretir -> mikrofon "olu/kapali" gorunur.
      if (this.micAudioCtx.state === 'suspended') {
        try { await this.micAudioCtx.resume(); } catch (e) {}
      }
      const source = this.micAudioCtx.createMediaStreamSource(rawStream);
      this.micGainNode = this.micAudioCtx.createGain();
      this.setInputGainDb(window.Store?.get('inputGainDb') ?? 0);
      const destination = this.micAudioCtx.createMediaStreamDestination();

      // Zincir: source → [RNNoise] → gain → destination
      let head = source;
      if (useRnnoise) {
        try {
          const node = await this._createRnnoiseNode(this.micAudioCtx);
          source.connect(node);
          head = node;
          this.rnnoiseNode = node;
        } catch (e) {
          // RNNoise yüklenemedi: mikrofonu ASLA kesme — RNNoise'suz devam et ve
          // bu oturumda bir daha deneme (sonraki startMic tarayıcı NS'ine düşer).
          console.warn('RNNoise yüklenemedi, devre dışı bırakıldı:', e);
          this.rnnoiseDisabled = true;
        }
      }
      head.connect(this.micGainNode).connect(destination);

      // VAD/seviye ölçer için MONITÖR çıkışı: gain sonrası (RNNoise'dan geçmiş)
      // ama ÇIKIŞ KAPISINDAN (track.enabled) bağımsız ayrı bir destination.
      // Böylece kapı mikrofonu kıssa bile analiz susmaz (kapı tekrar açılabilir)
      // ve VAD gürültüyü değil temizlenmiş sinyali dinler.
      this.micMonitorDest = this.micAudioCtx.createMediaStreamDestination();
      this.micGainNode.connect(this.micMonitorDest);
      this.micMonitorStream = this.micMonitorDest.stream;

      return destination.stream;
    } catch (e) {
      console.warn('Mikrofon kazancı uygulanamadı:', e);
      return rawStream;
    }
  }

  // RNNoise SIMD wasm'i destekleniyor mu? (küçük bir SIMD modülünü doğrula)
  async _rnnoiseSimdSupported() {
    try {
      return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
        10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ]));
    } catch (e) { return false; }
  }

  async _ensureRnnoiseWasm() {
    if (this._rnnoiseWasm) return this._rnnoiseWasm;
    if (!window.audio?.loadRnnoiseWasm) throw new Error('audio köprüsü yok');
    const simd = await this._rnnoiseSimdSupported();
    this._rnnoiseWasm = await window.audio.loadRnnoiseWasm(simd); // ArrayBuffer
    return this._rnnoiseWasm;
  }

  async _createRnnoiseNode(ctx) {
    const wasm = await this._ensureRnnoiseWasm();
    if (!this._rnnoiseModuleCtxs.has(ctx)) {
      await ctx.audioWorklet.addModule('vendor/rnnoise/workletProcessor.js');
      this._rnnoiseModuleCtxs.add(ctx);
    }
    // wasmBinary'i kopya geç (transfer/neuter riskine karşı; her context için temiz)
    return new AudioWorkletNode(ctx, '@sapphi-red/web-noise-suppressor/rnnoise', {
      processorOptions: { maxChannels: 1, wasmBinary: wasm.slice(0) },
    });
  }

  setInputGainDb(db) {
    const value = Math.max(-20, Math.min(20, Number(db) || 0));
    if (this.micGainNode) this.micGainNode.gain.value = Math.pow(10, value / 20);
  }

  stopMic() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.rawMicStream && this.rawMicStream !== this.micStream) {
      this.rawMicStream.getTracks().forEach((t) => t.stop());
      this.rawMicStream = null;
    }
    if (this.rnnoiseNode) {
      try { this.rnnoiseNode.port.postMessage('destroy'); } catch (e) {}
      try { this.rnnoiseNode.disconnect(); } catch (e) {}
      this.rnnoiseNode = null;
    }
    this.micMonitorStream = null;
    this.micMonitorDest = null;
    if (this.micAudioCtx) {
      this.micAudioCtx.close().catch(() => {});
      this.micAudioCtx = null;
      this.micGainNode = null;
    }
  }

  setMicMuted(muted) {
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    }
  }

  // --- Kamera ---
  async startCamera(deviceId = this.selectedCameraId, height = 480) {
    this.stopCamera();
    const constraints = {
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        height: { ideal: height },
        frameRate: { ideal: 30 },
      },
    };
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (deviceId && ['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(e.name)) {
        constraints.video.deviceId = undefined;
        this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        deviceId = null;
      } else throw e;
    }
    this.selectedCameraId = deviceId || null;
    this.onLocalStreamChange();
    return this.cameraStream;
  }

  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
  }

  // --- Ekran paylaşımı ---
  //  sourceId  : Electron desktopCapturer'dan gelen kaynak id'si
  //  opts      : { width, height, fps, withAudio }
  async startScreen(sourceId, opts = {}) {
    this.stopScreen();
    const { maxWidth = 1920, maxHeight = 1080, fps = 30, withAudio = true } = opts;

    // Electron'da chromeMediaSource ile belirli pencere/ekranı yakalarız.
    const videoConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth,
        maxHeight,
        maxFrameRate: fps,
      },
    };

    let stream;
    if (withAudio) {
      // Sistem sesini de yakalamayı dene (her platformda çalışmayabilir)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
            },
          },
          video: videoConstraints,
        });
      } catch (e) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints,
        });
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints,
      });
    }

    this.screenStream = stream;
    this.onLocalStreamChange();
    return this.screenStream;
  }

  stopScreen() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
  }

  // --- Hoparlör (çıkış cihazı) seçimi ---
  //  setSinkId desteği gereken her <audio>/<video> elementine uygulanır.
  setOutputDevice(deviceId) {
    this.selectedOutputId = deviceId;
  }

  async applySinkId(element) {
    if (this.selectedOutputId && typeof element.setSinkId === 'function') {
      try {
        await element.setSinkId(this.selectedOutputId);
      } catch (e) {
        console.warn('setSinkId başarısız:', e);
      }
    }
  }

  // --- Aktif gönderilecek track'ler ---
  get micTrack() {
    return this.micStream?.getAudioTracks()[0] || null;
  }
  get cameraTrack() {
    return this.cameraStream?.getVideoTracks()[0] || null;
  }
  get screenTrack() {
    return this.screenStream?.getVideoTracks()[0] || null;
  }
  get screenAudioTrack() {
    return this.screenStream?.getAudioTracks()[0] || null;
  }
}

window.MediaManager = MediaManager;
