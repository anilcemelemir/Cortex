// =============================================================
//  Yapılandırma
// =============================================================
//  Sunucu adresi tek yerden. Yerelde test için localhost; arkadaşlarınla
//  kullanmak için kendi sunucunun adresini gir (deploy sonrası).
//  Kullanıcı, giriş ekranındaki "Sunucu adresi" alanından da
//  değiştirebilir (localStorage'a kaydedilir).
// =============================================================

window.CONFIG = {
  // Varsayılan sunucu. wss/https = TLS (uzak sunucu için şart).
  // Örn. uzak: 'wss://sesli.senin-sunucun.com'
  defaultServer: 'wss://cortexapp.web.tr',
  allowCustomServer: false,

  // --- ICE sunucuları ---
  // STUN: public IP keşfi (ücretsiz). TURN: NAT fallback (kendi sunucunda coturn).
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Kendi TURN'un (deploy rehberindeki coturn). Doldurunca P2P çok daha güvenilir:
    // { urls: 'turn:cortexapp.web.tr:3478', username: 'turnkullanici', credential: 'TURN_SIFRESI' },
  ],

  // =============================================================
  //  PING-DOSTU KALİTE PROFİLLERİ
  //  Upload bitrate tavanı = bufferbloat yok = oyun ping'i etkilenmez.
  // =============================================================
  qualityProfiles: {
    dusuk: {
      label: 'Düşük (oyun dostu)',
      audioBitrate: 32_000, cameraBitrate: 400_000, screenBitrate: 1_500_000,
      screenFps: 15, cameraHeight: 360,
    },
    dengeli: {
      label: 'Dengeli',
      audioBitrate: 48_000, cameraBitrate: 1_000_000, screenBitrate: 3_000_000,
      screenFps: 30, cameraHeight: 480,
    },
    yuksek: {
      label: 'Yüksek',
      audioBitrate: 64_000, cameraBitrate: 2_500_000, screenBitrate: 6_000_000,
      screenFps: 60, cameraHeight: 720,
    },
  },
  defaultProfile: 'dengeli',
};

// Tek "ws://host:port" veya "wss://host" değerinden REST ve WS adreslerini türet.
window.serverUrls = function (wsUrl) {
  const u = String(wsUrl || window.CONFIG.defaultServer).trim().replace(/\/+$/, '');
  const isSecure = u.startsWith('wss://') || u.startsWith('https://');
  const host = u.replace(/^(wss?|https?):\/\//, '');
  return {
    api: `${isSecure ? 'https' : 'http'}://${host}/api`,
    ws: `${isSecure ? 'wss' : 'ws'}://${host}/ws`,
  };
};
