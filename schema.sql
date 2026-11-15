-- Kooskia Opera House database schema (Cloudflare D1 / SQLite).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS shows (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT    NOT NULL,
  subtitle             TEXT    NOT NULL DEFAULT '',
  description          TEXT    NOT NULL DEFAULT '',
  notes                TEXT    NOT NULL DEFAULT '',
  image_id             INTEGER,
  regular_price_cents  INTEGER NOT NULL DEFAULT 1500,
  premium_price_cents  INTEGER NOT NULL DEFAULT 2000,
  regular_seats        INTEGER NOT NULL DEFAULT 100,
  premium_seats        INTEGER NOT NULL DEFAULT 40,
  published            INTEGER NOT NULL DEFAULT 1,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS performances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id    INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,              -- YYYY-MM-DD (local theatre time)
  start_time TEXT    NOT NULL,              -- HH:MM 24h
  end_time   TEXT    NOT NULL DEFAULT '',   -- HH:MM 24h, optional
  status     TEXT    NOT NULL DEFAULT 'on_sale'  -- on_sale | paused | cancelled
);
CREATE INDEX IF NOT EXISTS idx_perf_show ON performances(show_id, date, start_time);

CREATE TABLE IF NOT EXISTS orders (
  id                     TEXT    PRIMARY KEY,         -- e.g. KOH-7F3K9Q2M
  performance_id         INTEGER NOT NULL REFERENCES performances(id),
  regular_qty            INTEGER NOT NULL DEFAULT 0,
  premium_qty            INTEGER NOT NULL DEFAULT 0,
  total_cents            INTEGER NOT NULL DEFAULT 0,
  buyer_name             TEXT    NOT NULL DEFAULT '',
  buyer_email            TEXT    NOT NULL DEFAULT '',
  buyer_phone            TEXT    NOT NULL DEFAULT '',
  status                 TEXT    NOT NULL,            -- pending | paid | expired | cancelled
  source                 TEXT    NOT NULL DEFAULT 'online', -- online | box_office | comp
  note                   TEXT    NOT NULL DEFAULT '',
  square_order_id        TEXT,
  square_payment_link_id TEXT,
  square_payment_id      TEXT,
  hold_expires_at        INTEGER,                     -- epoch ms
  created_at             INTEGER NOT NULL,
  paid_at                INTEGER,
  checked_in             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_orders_perf   ON orders(performance_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_square ON orders(square_order_id);

CREATE TABLE IF NOT EXISTS images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mime       TEXT    NOT NULL,
  data_b64   TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
