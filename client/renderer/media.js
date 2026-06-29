class MediaManager {
  constructor() {
    this.micStream = null;
    this.rawMicStream = null;
    this.micAudioCtx = null;
    this.micGainNode = null;
    this.micOutputGainNode = null;
    this.micMonitorDest = null;
    this.cameraStream = null;
    this.screenStream = null;

    this.selectedMicId = null;
    this.selectedCameraId = null;
    this.selectedOutputId = null;

    this._rnnoiseWasm = null;
    this._rnnoiseModuleCtxs = new WeakSet();
    this.rnnoiseNode = null;
    this.rnnoiseDisabled = false;
    this.rnnoiseActive = false;
    this.rnnoiseReady = false;
    this.micMonitorStream = null;
    this.micMuted = false;
    this._micRunId = 0;
    this._rawMicMuteTimer = null;
    this.onLocalStreamChange = () => {};
    this.onMicEnded = () => {};
  }

  async enumerateDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return { mics: [], cameras: [], speakers: [] };
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some((d) => d.label)) {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch (e) {
        // Permission can be denied here; empty labels are still usable.
      }
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    return {
      mics: devices.filter((d) => d.kind === 'audioinput'),
      cameras: devices.filter((d) => d.kind === 'videoinput'),
      speakers: devices.filter((d) => d.kind === 'audiooutput'),
    };
  }

  async startMic(deviceId = this.selectedMicId) {
    this.stopMic();
    const runId = ++this._micRunId;
    const wantNoiseSuppression = window.Store?.get('noiseSuppression') !== false;
    const useRnnoise = wantNoiseSuppression && !this.rnnoiseDisabled;
    const browserNs = wantNoiseSuppression && !useRnnoise;
    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: browserNs,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
      video: false,
    };

    let rawStream = null;
    try {
      rawStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (deviceId && ['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(e.name)) {
        constraints.audio.deviceId = undefined;
        rawStream = await navigator.mediaDevices.getUserMedia(constraints);
        deviceId = null;
      } else {
        throw e;
      }
    }

    if (runId !== this._micRunId) {
      this._stopStream(rawStream);
      return null;
    }

    this.rawMicStream = rawStream;
    this.selectedMicId = deviceId || null;
    this.rnnoiseActive = false;
    this.rnnoiseReady = false;
    this._bindRawMicEvents(rawStream);

    const builtStream = await this._buildMicGainStream(rawStream, useRnnoise, runId);
    if (runId !== this._micRunId) {
      this._stopStream(builtStream);
      if (builtStream !== rawStream) this._stopStream(rawStream);
      return null;
    }

    this.micStream = builtStream || rawStream;

    if (useRnnoise && this.rnnoiseDisabled && !this.rnnoiseActive) {
      return this.startMic(this.selectedMicId);
    }

    this.setMicMuted(this.micMuted);
    this.onLocalStreamChange();
    return this.micStream;
  }

  async _buildMicGainStream(rawStream, useRnnoise = false, runId = this._micRunId) {
    try {
      this.micAudioCtx = new AudioContext({ sampleRate: 48000 });
      this._armMicContextRecovery();
      await this.resumeMicContext();

      const source = this.micAudioCtx.createMediaStreamSource(rawStream);
      this.micGainNode = this.micAudioCtx.createGain();
      this.micOutputGainNode = this.micAudioCtx.createGain();
      this.micOutputGainNode.gain.value = this.micMuted ? 0 : 1;
      this.setInputGainDb(window.Store?.get('inputGainDb') ?? 0);

      const destination = this.micAudioCtx.createMediaStreamDestination();

      let head = source;
      if (useRnnoise) {
        try {
          const node = await this._createRnnoiseNode(this.micAudioCtx);
          const readyTimer = window.setTimeout(() => {
            if (runId !== this._micRunId || node !== this.rnnoiseNode || this.rnnoiseReady) return;
            console.warn('RNNoise hazir sinyali vermedi, tarayici gurultu engellemesine geciliyor.');
            this.rnnoiseActive = false;
            this.rnnoiseDisabled = true;
            this.onMicEnded('rnnoise-error');
          }, 3000);
          node.port.onmessage = (event) => {
            if (runId !== this._micRunId || node !== this.rnnoiseNode) return;
            if (event.data?.type === 'ready') {
              window.clearTimeout(readyTimer);
              this.rnnoiseActive = true;
              this.rnnoiseReady = true;
            } else if (event.data?.type === 'error') {
              window.clearTimeout(readyTimer);
              console.warn('RNNoise islemcisi hata verdi, tarayici gurultu engellemesine geciliyor:', event.data.message);
              this.rnnoiseActive = false;
              this.rnnoiseReady = false;
              this.rnnoiseDisabled = true;
              this.onMicEnded('rnnoise-error');
            }
          };
          source.connect(node);
          head = node;
          this.rnnoiseNode = node;
          this.rnnoiseActive = true;
          this.rnnoiseReady = false;
        } catch (e) {
          console.warn('RNNoise yuklenemedi, tarayici gurultu engellemesine gecildi:', e);
          this.rnnoiseDisabled = true;
          this.rnnoiseActive = false;
          this.rnnoiseReady = false;
        }
      }

      head.connect(this.micGainNode);
      this.micMonitorDest = this.micAudioCtx.createMediaStreamDestination();
      this.micGainNode.connect(this.micMonitorDest);
      this.micGainNode.connect(this.micOutputGainNode).connect(destination);
      this.micMonitorStream = this.micMonitorDest.stream;

      return destination.stream;
    } catch (e) {
      console.warn('Mikrofon ses zinciri kurulamadı, ham mikrofon kullanılıyor:', e);
      this.micAudioCtx = null;
      this.micGainNode = null;
      this.micOutputGainNode = null;
      this.micMonitorDest = null;
      this.micMonitorStream = rawStream;
      return rawStream;
    }
  }

  async _rnnoiseSimdSupported() {
    if (!WebAssembly?.validate) return false;
    const simdProbe = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65,
      0, 253, 15, 253, 98, 11,
    ]);
    return WebAssembly.validate(simdProbe);
  }

  async _ensureRnnoiseWasm() {
    if (this._rnnoiseWasm) return this._rnnoiseWasm;
    if (!window.audio?.loadRnnoiseWasm) throw new Error('audio koprusu yok');
    const simd = await this._rnnoiseSimdSupported();
    this._rnnoiseWasm = await window.audio.loadRnnoiseWasm(simd);
    return this._rnnoiseWasm;
  }

  async _createRnnoiseNode(ctx) {
    const wasm = await this._ensureRnnoiseWasm();
    if (!this._rnnoiseModuleCtxs.has(ctx)) {
      await ctx.audioWorklet.addModule('vendor/rnnoise/workletProcessor.js');
      this._rnnoiseModuleCtxs.add(ctx);
    }
    return new AudioWorkletNode(ctx, '@sapphi-red/web-noise-suppressor/rnnoise', {
      processorOptions: { maxChannels: 1, wasmBinary: wasm.slice(0) },
    });
  }

  resetNoiseSuppressionFailure() {
    this.rnnoiseDisabled = false;
    this.rnnoiseReady = false;
  }

  async resumeMicContext() {
    if (this.micAudioCtx?.state === 'suspended') {
      try {
        await this.micAudioCtx.resume();
      } catch (e) {
        console.warn('Mikrofon audio context devam ettirilemedi:', e);
      }
    }
  }

  _armMicContextRecovery() {
    if (!this.micAudioCtx) return;
    this.micAudioCtx.onstatechange = () => {
      if (this.micAudioCtx?.state === 'suspended' && this.rawMicStream) {
        window.setTimeout(() => this.resumeMicContext(), 120);
      }
    };
  }

  _bindRawMicEvents(stream) {
    const track = stream?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = true;
    track.onended = () => this.onMicEnded('ended');
    track.onmute = () => {
      window.clearTimeout(this._rawMicMuteTimer);
      this._rawMicMuteTimer = window.setTimeout(() => {
        if (track.readyState === 'live' && track.muted) {
          this.onMicEnded('muted');
        }
      }, 1800);
    };
    track.onunmute = () => window.clearTimeout(this._rawMicMuteTimer);
  }

  isMicHealthy() {
    const outTrack = this.micStream?.getAudioTracks?.()[0];
    const rawTrack = this.rawMicStream?.getAudioTracks?.()[0];
    if (!outTrack || outTrack.readyState !== 'live') return false;
    if (!rawTrack || rawTrack.readyState !== 'live') return false;
    if (this.micAudioCtx && this.micAudioCtx.state === 'closed') return false;
    return true;
  }

  stopMic() {
    this._micRunId += 1;
    window.clearTimeout(this._rawMicMuteTimer);

    const micStream = this.micStream;
    const rawStream = this.rawMicStream;

    this.micStream = null;
    this.rawMicStream = null;
    this.micMonitorStream = null;
    this.micMonitorDest = null;
    this.rnnoiseActive = false;
    this.rnnoiseReady = false;

    rawStream?.getAudioTracks?.().forEach((track) => {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
    });

    this._stopStream(micStream);
    if (rawStream && rawStream !== micStream) this._stopStream(rawStream);

    if (this.rnnoiseNode) {
      try {
        this.rnnoiseNode.port.postMessage('destroy');
      } catch (e) {}
      try {
        this.rnnoiseNode.disconnect();
      } catch (e) {}
      this.rnnoiseNode = null;
    }

    if (this.micAudioCtx) {
      this.micAudioCtx.onstatechange = null;
      this.micAudioCtx.close().catch(() => {});
      this.micAudioCtx = null;
    }
    this.micGainNode = null;
    this.micOutputGainNode = null;
  }

  setMicMuted(muted) {
    const nextMuted = Boolean(muted);
    this.micMuted = nextMuted;
    this.resumeMicContext();

    if (this.micOutputGainNode && this.micAudioCtx?.state !== 'closed') {
      const now = this.micAudioCtx.currentTime;
      const target = nextMuted ? 0 : 1;
      this.micOutputGainNode.gain.cancelScheduledValues(now);
      this.micOutputGainNode.gain.setTargetAtTime(target, now, 0.012);
      return;
    }

    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((t) => {
        t.enabled = !nextMuted;
      });
    }
  }

  setInputGainDb(db) {
    if (!this.micGainNode) return;
    const clamped = Math.max(-20, Math.min(20, Number(db) || 0));
    this.micGainNode.gain.value = Math.pow(10, clamped / 20);
  }

  async startCamera(deviceId = this.selectedCameraId) {
    this.stopCamera();
    const constraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    };
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (deviceId && ['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(e.name)) {
        constraints.video.deviceId = undefined;
        this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
        deviceId = null;
      } else {
        throw e;
      }
    }
    this.selectedCameraId = deviceId || null;
    this.onLocalStreamChange();
    return this.cameraStream;
  }

  stopCamera() {
    this._stopStream(this.cameraStream);
    this.cameraStream = null;
    this.onLocalStreamChange();
  }

  async startScreen({ withAudio = true } = {}) {
    this.stopScreen();
    const displayMedia = navigator.mediaDevices.getDisplayMedia || navigator.getDisplayMedia;
    if (!displayMedia) throw new Error('Ekran paylaşımı desteklenmiyor');
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 30 } },
      audio: withAudio,
    });
    this.screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
      this.stopScreen();
    });
    this.onLocalStreamChange();
    return this.screenStream;
  }

  stopScreen() {
    this._stopStream(this.screenStream);
    this.screenStream = null;
    this.onLocalStreamChange();
  }

  get screenAudioTrack() {
    return this.screenStream?.getAudioTracks?.()[0] || null;
  }

  setOutputDevice(deviceId) {
    const id = deviceId || window.Store?.get('speakerId') || null;
    this.selectedOutputId = id || null;
  }

  async applySinkId(audioEl) {
    const id = this.selectedOutputId || window.Store?.get('speakerId') || null;
    if (!audioEl?.setSinkId) return;
    try {
      await audioEl.setSinkId(id || '');
    } catch (e) {
      console.warn('Ses cikis cihazi uygulanamadi:', e);
    }
  }

  _stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch (e) {}
    });
  }

  get micTrack() {
    return this.micStream?.getAudioTracks()[0] || null;
  }

  get cameraTrack() {
    return this.cameraStream?.getVideoTracks()[0] || null;
  }

  get screenTrack() {
    return this.screenStream?.getVideoTracks()[0] || null;
  }
}
