// =============================================================
//  Global Push-to-Talk (main süreç)
// =============================================================
//  uiohook-napi ile TÜM sistemde (oyun açıkken bile) tuş basma/bırakma
//  yakalar. Renderer'dan gelen tuş kodu (KeyboardEvent.code) uiohook
//  keycode'una çevrilir; eşleşen keydown/keyup renderer'a iletilir.
//
//  Native modül yüklenemezse sessizce devre dışı kalır; renderer
//  uygulama-içi yedek PTT'ye düşer.
// =============================================================

let uIOhook = null;
let UiohookKey = null;
try {
  ({ uIOhook, UiohookKey } = require('uiohook-napi'));
} catch (e) {
  console.warn('uiohook-napi yüklenemedi, global PTT devre dışı:', e.message);
}

// KeyboardEvent.code -> UiohookKey eşlemesi
function codeToKeycode(code) {
  if (!UiohookKey || !code) return null;
  const K = UiohookKey;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return K[m[1]];
  if ((m = /^Digit([0-9])$/.exec(code))) return K[m[1]];
  if ((m = /^F([0-9]{1,2})$/.exec(code))) return K['F' + m[1]];
  const named = {
    Space: K.Space, CapsLock: K.CapsLock, Enter: K.Enter, Tab: K.Tab,
    Backspace: K.Backspace, Escape: K.Escape,
    ShiftLeft: K.Shift, ShiftRight: K.ShiftRight,
    ControlLeft: K.Ctrl, ControlRight: K.CtrlRight,
    AltLeft: K.Alt, AltRight: K.AltRight,
    MetaLeft: K.Meta, MetaRight: K.MetaRight,
    ArrowUp: K.ArrowUp, ArrowDown: K.ArrowDown, ArrowLeft: K.ArrowLeft, ArrowRight: K.ArrowRight,
    Home: K.Home, End: K.End, PageUp: K.PageUp, PageDown: K.PageDown,
    Insert: K.Insert, Delete: K.Delete,
    Backquote: K.Backquote, Minus: K.Minus, Equal: K.Equal,
    BracketLeft: K.BracketLeft, BracketRight: K.BracketRight, Backslash: K.Backslash,
    Semicolon: K.Semicolon, Quote: K.Quote, Comma: K.Comma, Period: K.Period, Slash: K.Slash,
  };
  return named[code] != null ? named[code] : null;
}

let started = false;
let targetKeycode = null;
let onChange = () => {};

function init(changeCallback) {
  onChange = changeCallback;
  if (!uIOhook) return;
  uIOhook.on('keydown', (e) => { if (targetKeycode != null && e.keycode === targetKeycode) onChange(true); });
  uIOhook.on('keyup', (e) => { if (targetKeycode != null && e.keycode === targetKeycode) onChange(false); });
}

// Belirli bir tuş için dinlemeyi başlat. Başarılıysa true.
function start(code) {
  if (!uIOhook) return false;
  const kc = codeToKeycode(code);
  if (kc == null) return false;
  targetKeycode = kc;
  if (!started) { try { uIOhook.start(); started = true; } catch (e) { return false; } }
  return true;
}

function stop() { targetKeycode = null; }

function shutdown() { if (uIOhook && started) try { uIOhook.stop(); } catch {} }

module.exports = { init, start, stop, shutdown, available: () => !!uIOhook };
