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
    // Release build sirasinda GitHub Secret ile TURN eklenir.
    // Public repo'ya gercek TURN sifresi commit etme.
  ],

  // =============================================================
  //  SABİT MEDYA AYARLARI
  //  Ses her zaman önceliklidir ve sabittir; ekran kalitesi tek yerden
  //  (Ekran Paylaş modal'ındaki çözünürlük/fps seçimi) yönetilir.
  // =============================================================
  media: {
    audioBitrate: 64_000,        // Opus — ses her zaman öncelikli, sabit
    cameraBitrate: 1_500_000,    // kamera upload tavanı
    cameraHeight: 720,           // kamera yakalama yüksekliği
  },

  // Ekran upload bitrate'ini seçilen çözünürlük×fps'ten türet. Sabit bits-per-pixel
  // + makul tavan: sesi açlığa düşürmeyecek kadar düşük, neti koruyacak kadar yüksek.
  screenBitrate(height, fps) {
    const width = Math.round((height * 16) / 9);
    const bpp = 0.08;                                       // ekran içeriği için
    const raw = Math.round(width * height * fps * bpp);
    return Math.max(1_000_000, Math.min(8_000_000, raw));  // 1–8 Mbps
  },
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
