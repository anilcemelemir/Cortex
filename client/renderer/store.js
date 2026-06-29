// =============================================================
//  Kalıcı Ayarlar (localStorage)
// =============================================================
//  Oturum token'ı, seçili sunucu adresi, cihaz tercihleri, ses modu
//  ve push-to-talk tuşu burada saklanır.
// =============================================================

const KEY = 'sesli-sohbet';

const defaults = {
  token: null,
  serverUrl: window.CONFIG.defaultServer,
  micId: null,
  speakerId: null,
  cameraId: null,
  screenMode: 'net',       // ekran paylaşımı önceliği: 'net' (çözünürlük) | 'akici' (fps)
  voiceMode: 'vad',        // 'vad' (ses algılama) | 'ptt' (bas-konuş)
  noiseSuppression: true,  // mikrofon gürültü azaltma (tarayıcı/Chromium)
  pttKey: 'CapsLock',      // push-to-talk tuşu (varsayılan)
  pttKeyLabel: 'Caps Lock',
  activityEnabled: true,
  inputGainDb: 0,
  outputVolume: 1,
  vadThresholdDb: -55,
  inputVolume: 1,          // 0..1 (mikrofon kazancı, ileride)
  vadThreshold: 18,        // konuşma algılama eşiği
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

let cache = load();

window.Store = {
  get(k) { return cache[k]; },
  all() { return { ...cache }; },
  set(k, v) {
    cache[k] = v;
    localStorage.setItem(KEY, JSON.stringify(cache));
  },
  update(obj) {
    cache = { ...cache, ...obj };
    localStorage.setItem(KEY, JSON.stringify(cache));
  },
  clearAuth() {
    cache.token = null;
    localStorage.setItem(KEY, JSON.stringify(cache));
  },
};
