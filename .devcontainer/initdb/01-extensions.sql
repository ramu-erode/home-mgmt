-- Extensions the schema depends on (ADR-002).
-- Runs once, on first creation of the dev database volume.
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- app_user.email
