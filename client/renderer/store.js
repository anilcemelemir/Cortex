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
  micProfile: null,
  speakerProfile: null,
  cameraProfile: null,
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
const persistentKeys = new Set([
  'serverUrl',
  'micId',
  'speakerId',
  'cameraId',
  'micProfile',
  'speakerProfile',
  'cameraProfile',
  'screenMode',
  'voiceMode',
  'noiseSuppression',
  'pttKey',
  'pttKeyLabel',
  'activityEnabled',
  'inputGainDb',
  'outputVolume',
  'vadThresholdDb',
  'inputVolume',
  'vadThreshold',
]);

function saveLocal() {
  localStorage.setItem(KEY, JSON.stringify(cache));
}

function persistentPatch(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (persistentKeys.has(key)) out[key] = value;
  }
  return out;
}

function savePersistent(obj) {
  const patch = persistentPatch(obj);
  if (Object.keys(patch).length === 0) return;
  window.settings?.update?.(patch).catch((e) => console.warn('Kalıcı ayarlar yazılamadı:', e));
}

const readyPromise = window.settings?.get?.()
  .then((saved) => {
    cache = { ...cache, ...persistentPatch(saved || {}) };
    saveLocal();
    savePersistent(cache);
    return cache;
  })
  .catch((e) => {
    console.warn('Kalıcı ayarlar okunamadı:', e);
    return cache;
  }) || Promise.resolve(cache);

window.Store = {
  ready() { return readyPromise; },
  get(k) { return cache[k]; },
  all() { return { ...cache }; },
  set(k, v) {
    cache[k] = v;
    saveLocal();
    savePersistent({ [k]: v });
  },
  update(obj) {
    cache = { ...cache, ...obj };
    saveLocal();
    savePersistent(obj);
  },
  clearAuth() {
    cache.token = null;
    saveLocal();
  },
};
