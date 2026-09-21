-- 0001 — initial schema.
--
-- The schema of record (ADR-016). Read with ADR-003 (rule vs occurrence),
-- ADR-007 (tombstones), ADR-009 (sync columns), ADR-010 (flow model),
-- ADR-011 (reserve and goals), ADR-014 (device identity).
--
-- Conventions, every synced table:
--   id                 uuid, client-generatable (ADR-006)
--   version            sync cursor, set by trigger — never by the application
--   client_updated_at  originating device's clock; decides last-write-wins
--   updated_at         audit only, set by trigger
--   updated_by_device  audit only
--   deleted_at         tombstone; hard DELETE is refused outside the purge job

-- ---------------------------------------------------------------------------
-- Sync plumbing (ADR-009)

CREATE SEQUENCE sync_version AS bigint;

-- Singleton: the lowest version the tombstone purge has kept.
CREATE TABLE sync_state (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id),
  min_retained_version bigint  NOT NULL DEFAULT 0
);
INSERT INTO sync_state DEFAULT VALUES;

-- Every write takes the same transaction-level advisory lock *before* it draws
-- a version, so versions commit in the order they were allocated and a delta
-- pull can never skip a row that commits late. Doing it here rather than in
-- the repository means no write path can forget it.
CREATE FUNCTION stamp_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('homemgmt.sync_version'));
  NEW.version    := nextval('sync_version');
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Nothing syncable is hard-deleted (ADR-007). The purge job sets
-- `SET LOCAL homemgmt.purge = 'on'` in its own transaction.
CREATE FUNCTION refuse_hard_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('homemgmt.purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'hard DELETE on % is not allowed; set deleted_at (ADR-007)', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END $$;

-- ---------------------------------------------------------------------------
-- People and devices (ADR-014)

CREATE TABLE member (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL CHECK (name <> ''),
  display_order     smallint    NOT NULL DEFAULT 0,
  version           bigint      NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by_device uuid,
  deleted_at        timestamptz
);

-- An installed app. Replaces app_user: one shared Tailscale login cannot tell
-- people apart, so edits are attributed to the phone.
CREATE TABLE device (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL CHECK (name <> ''),
  member_id         uuid        REFERENCES member (id),
  version           bigint      NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by_device uuid        REFERENCES device (id),
  deleted_at        timestamptz
);

ALTER TABLE member ADD FOREIGN KEY (updated_by_device) REFERENCES device (id);

-- ---------------------------------------------------------------------------
-- Categories — two-level roll-up; income sources live here too (ADR-010).
-- The two-level limit is enforced by the API, not a constraint.

CREATE TABLE category (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL CHECK (name <> ''),
  parent_id         uuid        REFERENCES category (id) CHECK (parent_id <> id),
  version           bigint      NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by_device uuid        REFERENCES device (id),
  deleted_at        timestamptz
);

-- ---------------------------------------------------------------------------
-- Flows — the rule (ADR-003, ADR-010, ADR-013)

CREATE TABLE flow (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL CHECK (name <> ''),
  category_id       uuid        REFERENCES category (id),
  direction         text        NOT NULL CHECK (direction IN ('OUT', 'IN')),
  recurrence_kind   text        NOT NULL CHECK (recurrence_kind IN ('INTERVAL', 'MONTHS', 'ONE_OFF')),
  freq              text        CHECK (freq IN ('MONTHLY', 'YEARLY')),
  "interval"        smallint    CHECK ("interval" >= 1),
  months            smallint[]  CHECK (months <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[] AND cardinality(months) > 0),
  day_of_month      smallint    CHECK (day_of_month BETWEEN 1 AND 31),
  start_date        date        NOT NULL,
  end_date          date        CHECK (end_date >= start_date),
  version           bigint      NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by_device uuid        REFERENCES device (id),
  deleted_at        timestamptz,

  -- Each kind carries exactly its own fields.
  CONSTRAINT flow_kind_fields CHECK (
    (recurrence_kind = 'INTERVAL' AND freq IS NOT NULL AND "interval" IS NOT NULL
       AND day_of_month IS NOT NULL AND months IS NULL)
    OR (recurrence_kind = 'MONTHS' AND months IS NOT NULL AND day_of_month IS NOT NULL
       AND freq IS NULL AND "interval" IS NULL)
    OR (recurrence_kind = 'ONE_OFF' AND freq IS NULL AND "interval" IS NULL
       AND months IS NULL AND day_of_month IS NULL)
  )
);

-- Scheduled amount changes: fee hikes, renewals.
CREATE TABLE flow_amount (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id           uuid          NOT NULL REFERENCES flow (id),
  effective_from    date          NOT NULL,
  amount            numeric(14,2) NOT NULL CHECK (amount >= 0),
  version           bigint        NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at timestamptz   NOT NULL DEFAULT now(),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  updated_by_device uuid          REFERENCES device (id),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX uq_flow_amount ON flow_amount (flow_id, effective_from) WHERE deleted_at IS NULL;

-- Member split by weight. No live rows = household-general (ADR-010).
CREATE TABLE flow_allocation (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id           uuid        NOT NULL REFERENCES flow (id),
  member_id         uuid        NOT NULL REFERENCES member (id),
  weight            smallint    NOT NULL CHECK (weight > 0),
  version           bigint      NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by_device uuid        REFERENCES device (id),
  deleted_at        timestamptz
);
CREATE UNIQUE INDEX uq_flow_allocation ON flow_allocation (flow_id, member_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Occurrences — materialised by the server only (ADR-009)
--
-- rule_date is the date the rule produced and never changes; due_date moves
-- only by a date override. Regeneration matches on (flow_id, rule_date):
-- matching on due_date would re-insert the rule date of every row whose date
-- was overridden. Direction is read from the flow, not copied here.

CREATE TABLE occurrence (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id              uuid          NOT NULL REFERENCES flow (id),
  rule_date            date          NOT NULL,
  due_date             date          NOT NULL,
  amount               numeric(14,2) NOT NULL CHECK (amount >= 0),
  status               text          NOT NULL DEFAULT 'PLANNED'
                                     CHECK (status IN ('PLANNED', 'CONFIRMED', 'SETTLED', 'SKIPPED')),
  is_amount_overridden boolean       NOT NULL DEFAULT false,
  is_date_overridden   boolean       NOT NULL DEFAULT false,
  settled_on           date,
  settled_amount       numeric(14,2) CHECK (settled_amount >= 0),
  note                 text,
  version              bigint        NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at    timestamptz   NOT NULL DEFAULT now(),
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),
  updated_by_device    uuid          REFERENCES device (id),
  deleted_at           timestamptz,

  CONSTRAINT occurrence_date_override CHECK (is_date_overridden OR due_date = rule_date),
  CONSTRAINT occurrence_settlement CHECK (
    (status = 'SETTLED') = (settled_on IS NOT NULL AND settled_amount IS NOT NULL)
  )
);

-- Partial, or a tombstone blocks regenerating its own date (ADR-007).
CREATE UNIQUE INDEX uq_occurrence ON occurrence (flow_id, rule_date) WHERE deleted_at IS NULL;
CREATE INDEX ix_occurrence_due ON occurrence (due_date) WHERE deleted_at IS NULL AND status <> 'SKIPPED';

-- ---------------------------------------------------------------------------
-- Projection anchor and goals (ADR-011)
--
-- balance = reserved_amount + Σ goal.saved_amount + free. The cross-table part
-- is checked by the engine; the single-row part is checked here.

CREATE TABLE balance_snapshot (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of             date          NOT NULL,
  balance           numeric(14,2) NOT NULL,
  reserved_amount   numeric(14,2) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0 AND reserved_amount <= balance),
  version           bigint        NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at timestamptz   NOT NULL DEFAULT now(),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  updated_by_device uuid          REFERENCES device (id),
  deleted_at        timestamptz
);
CREATE INDEX ix_balance_snapshot_as_of ON balance_snapshot (as_of DESC) WHERE deleted_at IS NULL;

CREATE TABLE goal (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text          NOT NULL CHECK (name <> ''),
  member_id         uuid          REFERENCES member (id),
  target_amount     numeric(14,2) NOT NULL CHECK (target_amount > 0),
  target_date       date          NOT NULL,
  saved_amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (saved_amount >= 0),
  priority          smallint      NOT NULL DEFAULT 1,
  version           bigint        NOT NULL DEFAULT 0,  -- overwritten by stamp_sync()
  client_updated_at timestamptz   NOT NULL DEFAULT now(),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  updated_by_device uuid          REFERENCES device (id),
  deleted_at        timestamptz
);

-- ---------------------------------------------------------------------------
-- Triggers and the delta-pull index, for every synced table

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['member', 'device', 'category', 'flow', 'flow_amount',
                           'flow_allocation', 'occurrence', 'balance_snapshot', 'goal']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION stamp_sync()', t || '_stamp_sync', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION refuse_hard_delete()', t || '_no_hard_delete', t);
    EXECUTE format('CREATE INDEX %I ON %I (version)', 'ix_' || t || '_version', t);
  END LOOP;
END $$;
