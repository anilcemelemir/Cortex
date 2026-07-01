// =============================================================
//  Electron Ana Süreç (Main Process)
// =============================================================
//  Görevleri:
//   - Uygulama penceresini açmak
//   - Ekran/pencere paylaşım kaynaklarını listelemek (desktopCapturer)
//   - Renderer ile güvenli IPC köprüsü kurmak (preload üzerinden)
// =============================================================

const { app, BrowserWindow, ipcMain, desktopCapturer, session, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const ptt = require('./ptt');

let mainWindow;
let tray = null;
app.isQuitting = false;
// --autostart ile açıldıysa (Windows oturum açılışı) pencereyi gösterme,
// sessizce tepsiye in.
const startHidden = process.argv.includes('--autostart');
const APP_ICON = path.join(__dirname, '..', 'assets', 'icon.png');

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettingsFile() {
  try {
    return JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeSettingsFile(settings) {
  const file = settingsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings || {}, null, 2), 'utf8');
}

// Tek örnek: ikinci kez açılırsa (örn. tepsideyken kısayola tıklanırsa)
// yeni pencere açma, mevcut olanı öne getir.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}
const GAME_PROCESSES = new Map(Object.entries({
  'cs2': 'Counter-Strike 2',
  'csgo': 'Counter-Strike',
  'valorant': 'VALORANT',
  'leagueclientux': 'League of Legends',
  'league of legends': 'League of Legends',
  'fortniteclient-win64-shipping': 'Fortnite',
  'gta5': 'Grand Theft Auto V',
  'minecraft': 'Minecraft',
  'javaw': 'Minecraft',
  'robloxplayerbeta': 'Roblox',
  'dota2': 'Dota 2',
  'overwatch': 'Overwatch 2',
  'destiny2': 'Destiny 2',
  'r5apex': 'Apex Legends',
  'rocketleague': 'Rocket League',
  'eldenring': 'Elden Ring',
  'cyberpunk2077': 'Cyberpunk 2077',
  'witcher3': 'The Witcher 3',
  'terraria': 'Terraria',
  'tmodloader': 'tModLoader',
  'bg3': "Baldur's Gate 3",
  'palworld-win64-shipping': 'Palworld',
  'helldivers2': 'HELLDIVERS 2',
  'starfield': 'Starfield',
  'tlauncher': 'Minecraft',
  'steam': 'Steam',
  'epicgameslauncher': 'Epic Games',
}));
const ACTIVITY_PROCESS_NAMES = [...new Set(['spotify', ...GAME_PROCESSES.keys()])];

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: 4500,
      maxBuffer: 1024 * 512,
    }, (err, stdout) => {
      if (err) return resolve([]);
      try { resolve(JSON.parse(stdout || '[]')); } catch { resolve([]); }
    });
  });
}

function cleanWindowTitle(title) {
  return String(title || '')
    .replace(/\s+-\s+Spotify$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function detectDesktopActivity() {
  if (process.platform !== 'win32') return null;
  const names = ACTIVITY_PROCESS_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
  const rows = await runPowerShell(`
    Get-Process -Name ${names} -ErrorAction SilentlyContinue |
      Select-Object ProcessName, MainWindowTitle |
      ConvertTo-Json -Compress
  `);
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);

  const spotify = list.find((p) => String(p.ProcessName || '').toLowerCase() === 'spotify' && cleanWindowTitle(p.MainWindowTitle));
  if (spotify) {
    const title = cleanWindowTitle(spotify.MainWindowTitle);
    if (title && !/^spotify/i.test(title)) return { type: 'listening', name: title, service: 'Spotify' };
  }

  const candidates = list
    .map((p) => {
      const proc = String(p.ProcessName || '').toLowerCase();
      const title = String(p.MainWindowTitle || '').trim();
      const mapped = GAME_PROCESSES.get(proc);
      if (mapped && proc !== 'steam' && proc !== 'epicgameslauncher') return { type: 'playing', name: mapped };
      for (const [key, value] of GAME_PROCESSES) {
        if (key !== 'steam' && key !== 'epicgameslauncher' && proc.includes(key)) return { type: 'playing', name: value };
      }
      if (/minecraft/i.test(title)) return { type: 'playing', name: 'Minecraft' };
      return null;
    })
    .filter(Boolean);
  return candidates[0] || null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#20232a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#20232a',
      symbolColor: '#dbdee1',
      height: 32,
    },
    darkTheme: true,
    title: 'Cortex',
    icon: APP_ICON,
    show: false, // ready-to-show'da göster (autostart'ta gizli kalır)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });

  // Kapatma (X) → tepsiye in, uygulamayı arka planda çalışır tut.
  // Gerçek çıkış yalnızca tepsi menüsü / app.quit ile olur.
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Renderer konsolunu (uyarı/hata) terminale aktar — hata ayıklama için
  mainWindow.webContents.on('console-message', (e, level, message, line, source) => {
    if (level >= 2) console.log(`[renderer ${level === 3 ? 'ERROR' : 'WARN'}] ${message} (${source}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (e, details) => {
    console.log('[renderer GONE]', details.reason);
  });

  // Geliştirme sırasında DevTools açmak istersen:
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// --- AFK / boşta tespiti (sistem genelinde, uygulama arkadayken bile) ---
const AFK_THRESHOLD_SEC = 300; // 5 dk hareketsizlik → boşta
let lastIdle = false;
let idleTimer = null;
function startIdleWatch() {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    let idle = false;
    try {
      const state = powerMonitor.getSystemIdleState(AFK_THRESHOLD_SEC);
      idle = state === 'idle' || state === 'locked';
    } catch {}
    if (idle !== lastIdle) {
      lastIdle = idle;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('idle-change', idle);
    }
  }, 15000);
}

function showMainWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  let image = nativeImage.createFromPath(APP_ICON);
  if (!image.isEmpty()) image = image.resize({ width: 16, height: 16 });
  tray = new Tray(image.isEmpty() ? APP_ICON : image);
  tray.setToolTip('Cortex');
  const menu = Menu.buildFromTemplate([
    { label: 'Cortex\'i Aç', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Çıkış', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
}

// --- Ekran paylaşımı izinlerini otomatik ver (kendi uygulamamız) ---
app.whenReady().then(() => {
  // getDisplayMedia çağrısı için kaynak seçici. Biz kendi UI'mızda
  // kaynağı zaten seçtirdiğimiz için burada ek bir sistem diyaloğu
  // göstermiyoruz; renderer seçtiği kaynağı doğrudan kullanıyor.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      // Varsayılan: ilk ekran. Gerçek seçim renderer tarafında yapılıyor.
      callback({ video: sources[0], audio: 'loopback' });
    });
  }, { useSystemPicker: false });

  // Mikrofon/kamera/ekran izinlerini kendi uygulamamıza otomatik ver
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();
  createTray();
  startIdleWatch();

  // Global push-to-talk: tuş durumunu renderer'a ilet
  ptt.init((active) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ptt-change', active);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

// Tepsiye inince pencere gizli kalır (kapanmaz) → uygulama arka planda yaşar.
// Bu yüzden window-all-closed'da otomatik çıkış yapmıyoruz; çıkış tepsiden.
app.on('window-all-closed', () => {});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => ptt.shutdown());

// --- IPC: PTT kontrolü ---
ipcMain.handle('ptt-start', (e, code) => ptt.start(code));
ipcMain.handle('ptt-stop', () => { ptt.stop(); });
ipcMain.handle('activity-detect', () => detectDesktopActivity());
ipcMain.handle('settings-get', () => readSettingsFile());
ipcMain.handle('settings-set', (e, key, value) => {
  const settings = readSettingsFile();
  settings[key] = value;
  writeSettingsFile(settings);
  return settings;
});
ipcMain.handle('settings-update', (e, patch) => {
  const settings = { ...readSettingsFile(), ...(patch || {}) };
  writeSettingsFile(settings);
  return settings;
});

// --- IPC: RNNoise WASM ikilisini diskten oku (renderer fetch(file://) güvenilmez) ---
// renderer SIMD destegine gore dosyayi secer; ArrayBuffer dondururuz, worklet'e
// processorOptions.wasmBinary olarak gecilir.
ipcMain.handle('load-rnnoise-wasm', (e, simd) => {
  const file = simd ? 'rnnoise_simd.wasm' : 'rnnoise.wasm';
  const p = path.join(__dirname, 'renderer', 'vendor', 'rnnoise', file);
  const buf = fs.readFileSync(p);
  // Buffer -> bagimsiz ArrayBuffer (sadece ilgili bolge)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

// --- IPC: Windows/işletim sistemi ile başlat (oturum açılış öğesi) ---
ipcMain.handle('auto-launch-get', () => {
  try { return app.getLoginItemSettings().openAtLogin; }
  catch { return false; }
});
ipcMain.handle('auto-launch-set', (e, enabled) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      openAsHidden: false,
      args: ['--autostart'],
    });
    return app.getLoginItemSettings().openAtLogin;
  } catch { return false; }
});

// =============================================================
//  IPC: Ekran/pencere kaynaklarını renderer'a ver
// =============================================================
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });

  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.id.startsWith('screen:') ? 'screen' : 'window',
    thumbnail: s.thumbnail.toDataURL(),
    appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
  }));
});
