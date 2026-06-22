-- =====================================================================
-- DRESSING ROOM — by Basil Metric
-- Cloudflare D1 (SQLite) schema
-- =====================================================================
-- Two tables:
--   users        — birth metadata captured once at registration
--   daily_states — cached, computed style directives per user per date,
--                   so the astrology feed is only ever hit once per
--                   user per calendar day instead of on every page load
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,                 -- uuid, generated client-side or in worker
  name        TEXT NOT NULL,
  birth_date  TEXT NOT NULL,                     -- ISO 8601 date, e.g. 1996-04-12
  birth_time  TEXT NOT NULL,                     -- 24h local clock time, e.g. 07:45
  birth_place TEXT NOT NULL,                     -- display label, e.g. "Chiang Mai, Thailand"
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  timezone    TEXT NOT NULL,                     -- IANA tz, e.g. Asia/Bangkok
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);

-- ---------------------------------------------------------------------
-- daily_states
-- ---------------------------------------------------------------------
-- One row per (user_id, state_date). Acts as the cache layer: the worker
-- checks this table first and only calls the upstream astrology API if
-- no row exists yet for today's date in the user's local timezone.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_states (
  id              TEXT PRIMARY KEY,              -- uuid
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  state_date      TEXT NOT NULL,                 -- ISO date this state applies to, in user's local tz

  -- raw transit snapshot, stored so we can recompute directives later
  -- without a second upstream call if mapping logic changes
  dominant_element TEXT NOT NULL,                -- Fire | Air | Earth | Water
  element_balance  TEXT NOT NULL,                -- JSON: {"fire":0.0,"air":0.0,"earth":0.0,"water":0.0}
  transit_summary  TEXT NOT NULL,                -- JSON: raw planet/sign/house payload used to derive directives

  -- computed directives — the three things the UI renders
  vibe_text        TEXT NOT NULL,                -- editorial one-line/two-line copy
  outfit_hex       TEXT NOT NULL,                -- e.g. #2B2B2B
  outfit_name      TEXT NOT NULL,                -- e.g. "Graphite"
  hair_directive   TEXT NOT NULL,                -- 'up' | 'down'

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (user_id, state_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_states_user_date
  ON daily_states (user_id, state_date);
