// =============================================================
//  Preload Script
// =============================================================
//  Ana süreç ile renderer arasında SADECE ihtiyaç duyulan
//  fonksiyonları güvenli şekilde açar. nodeIntegration kapalı
//  olduğu için renderer doğrudan Node API'lerine erişemez;
//  her şey bu köprüden geçer.
// =============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  // Ekran/pencere paylaşım kaynaklarını getirir
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
});

contextBridge.exposeInMainWorld('activity', {
  detect: () => ipcRenderer.invoke('activity-detect'),
});

contextBridge.exposeInMainWorld('system', {
  // Windows ile başlat (oturum açılış öğesi) durumunu oku / ayarla
  getAutoLaunch: () => ipcRenderer.invoke('auto-launch-get'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('auto-launch-set', enabled),
  // Sistem boşta (AFK) durumu değişince haber ver
  onIdleChange: (cb) => ipcRenderer.on('idle-change', (e, idle) => cb(idle)),
});

// Global push-to-talk köprüsü
contextBridge.exposeInMainWorld('ptt', {
  start: (code) => ipcRenderer.invoke('ptt-start', code),
  stop: () => ipcRenderer.invoke('ptt-stop'),
  onChange: (cb) => ipcRenderer.on('ptt-change', (e, active) => cb(active)),
});
