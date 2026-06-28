// =============================================================
//  Veritabanı (SQLite — Node'un dahili node:sqlite modülü)
// =============================================================
//  Tek dosyalık SQLite. Native derleme/ayrı DB sunucusu gerekmez.
//  Kalıcı durum burada tutulur: hesaplar, sunucular (guild),
//  kanallar, üyelikler ve text mesajları.
// =============================================================

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Veri klasörü (VPS'te kalıcı bir volume'a denk gelebilsin diye env ile ayarlanır)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

// Performans + bütünlük ayarları
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

// --- Şema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color  TEXT NOT NULL,
    avatar_image  TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guilds (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    icon_image  TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guild_members (
    guild_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    role      TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id         TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,                 -- 'text' | 'voice'
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    content    TEXT NOT NULL,
    attachments TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_members_user     ON guild_members (user_id);
  CREATE INDEX IF NOT EXISTS idx_channels_guild   ON channels (guild_id, position);
`);

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn('users', 'avatar_image', 'avatar_image TEXT');
ensureColumn('guilds', 'icon_image', 'icon_image TEXT');
ensureColumn('messages', 'attachments', 'attachments TEXT');

// --- Yardımcılar ---
const newId = () => crypto.randomUUID();
const now = () => Date.now();

// Discord tarzı renkli avatar için rastgele bir renk
const AVATAR_COLORS = ['#5865f2', '#23a55a', '#f0b232', '#eb459e', '#e67e22', '#3498db', '#9b59b6', '#e74c3c'];
const randomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

// Kısa, okunabilir davet kodu (örn. "x7Kp2Qzm")
function genInviteCode() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

module.exports = { db, newId, now, randomColor, genInviteCode, DATA_DIR };
