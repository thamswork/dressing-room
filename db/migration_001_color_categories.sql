-- =====================================================================
-- DRESSING ROOM — by Basil Metric
-- Migration: replace single outfit colour with 4 lucky-colour categories
-- =====================================================================
-- Run this AFTER the initial schema.sql has already been applied once.
-- SQLite doesn't support DROP COLUMN in older versions cleanly alongside
-- ADD COLUMN in one statement, so we add the new columns, backfill them
-- from the old single colour (so existing rows don't break), then drop
-- the old columns.
-- =====================================================================

ALTER TABLE daily_states ADD COLUMN work_hex TEXT;
ALTER TABLE daily_states ADD COLUMN work_name TEXT;
ALTER TABLE daily_states ADD COLUMN charm_hex TEXT;
ALTER TABLE daily_states ADD COLUMN charm_name TEXT;
ALTER TABLE daily_states ADD COLUMN health_hex TEXT;
ALTER TABLE daily_states ADD COLUMN health_name TEXT;
ALTER TABLE daily_states ADD COLUMN avoid_hex TEXT;
ALTER TABLE daily_states ADD COLUMN avoid_name TEXT;

-- Backfill: reuse the old single outfit colour for "work" on existing rows,
-- and fall back to a neutral placeholder for the other three so old rows
-- still render something coherent. These will be replaced naturally as
-- soon as each user's cache expires and a fresh day is computed.
UPDATE daily_states
SET
  work_hex = outfit_hex,
  work_name = outfit_name,
  charm_hex = outfit_hex,
  charm_name = outfit_name,
  health_hex = outfit_hex,
  health_name = outfit_name,
  avoid_hex = '#1A1A1A',
  avoid_name = 'Onyx'
WHERE work_hex IS NULL;

-- SQLite (and D1) support DROP COLUMN as of recent versions.
ALTER TABLE daily_states DROP COLUMN outfit_hex;
ALTER TABLE daily_states DROP COLUMN outfit_name;
