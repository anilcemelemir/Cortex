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

    this.onLocalStreamChange = () => {};
  }

  // --- Sistem cihazlarını listele ---
  async enumerateDevices() {
    // İzin almadan label'lar boş gelir; önce kısa bir mikrofon izni alıyoruz.
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach((t) => t.stop());
    } catch (e) {
      // izin reddedilirse yine de boş label'larla devam
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      mics: devices.filter((d) => d.kind === 'audioinput'),
      speakers: devices.filter((d) => d.kind === 'audiooutput'),
      cameras: devices.filter((d) => d.kind === 'videoinput'),
    };
  }

  // --- Mikrofon ---
  async startMic(deviceId = this.selectedMicId) {
    this.stopMic();
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Discord benzeri ses işleme:
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Düşük gecikme için kanal/örnekleme:
        channelCount: 1,
        sampleRate: 48000,
      },
      video: false,
    };
    this.rawMicStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.micStream = this._buildMicGainStream(this.rawMicStream);
    this.selectedMicId = deviceId || null;
    this.onLocalStreamChange();
    return this.micStream;
  }

  _buildMicGainStream(rawStream) {
    try {
      this.micAudioCtx = new AudioContext();
      const source = this.micAudioCtx.createMediaStreamSource(rawStream);
      this.micGainNode = this.micAudioCtx.createGain();
      this.setInputGainDb(window.Store?.get('inputGainDb') ?? 0);
      const destination = this.micAudioCtx.createMediaStreamDestination();
      source.connect(this.micGainNode).connect(destination);
      return destination.stream;
    } catch (e) {
      console.warn('Mikrofon kazancı uygulanamadı:', e);
      return rawStream;
    }
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
    this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
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
