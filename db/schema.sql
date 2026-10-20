-- Japanese invoice workflow schema.
-- Security model: the application runs every request as the non-superuser
-- role app_user inside a transaction with app.user_id / app.org_id set.
-- Row-level security isolates organizations; triggers enforce the
-- workflow (roles, self-approval, immutability after export, monthly quota).

CREATE SCHEMA IF NOT EXISTS app;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE app.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  stripe_customer_id text UNIQUE,
  -- Creation time of the Stripe event that last changed the plan, so a retried
  -- older event cannot undo a newer one.
  plan_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND position('@' IN email) > 1),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.memberships (
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  user_id uuid NOT NULL REFERENCES app.users(id),
  role text NOT NULL CHECK (role IN ('member', 'approver', 'admin')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE app.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE app.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'reviewing', 'submitted', 'approved', 'rejected', 'exported')),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  file_type text NOT NULL CHECK (file_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  file_size integer NOT NULL CHECK (file_size BETWEEN 1 AND 10485760),
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  data jsonb,
  ai_data jsonb,
  issues jsonb NOT NULL DEFAULT '[]',
  account text,
  warning_note text,
  reject_reason text,
  extraction_meta jsonb,
  -- Upstream AI calls per invoice (MAX_EXTRACTIONS in src/core/workflow.ts).
  extraction_count integer NOT NULL DEFAULT 0 CHECK (extraction_count BETWEEN 0 AND 9),
  registration_number text,
  invoice_number text,
  total_amount bigint,
  uploaded_by uuid NOT NULL REFERENCES app.users(id),
  submitted_by uuid REFERENCES app.users(id),
  approved_by uuid REFERENCES app.users(id),
  export_batch_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_org_status ON app.invoices (org_id, status, created_at DESC);
CREATE INDEX invoices_duplicate ON app.invoices (org_id, registration_number, invoice_number, total_amount);

CREATE TABLE app.invoice_files (
  invoice_id uuid PRIMARY KEY REFERENCES app.invoices(id),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  content bytea NOT NULL
);

CREATE TABLE app.export_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  created_by uuid NOT NULL REFERENCES app.users(id),
  invoice_count integer NOT NULL CHECK (invoice_count > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.invoices
  ADD FOREIGN KEY (export_batch_id) REFERENCES app.export_batches(id);

CREATE TABLE app.vendor_accounts (
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  registration_number text NOT NULL,
  account text NOT NULL,
  PRIMARY KEY (org_id, registration_number)
);

CREATE TABLE app.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES app.organizations(id),
  invoice_id uuid REFERENCES app.invoices(id),
  actor_id uuid REFERENCES app.users(id),
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_at ON app.audit_log (org_id, at DESC);

CREATE TABLE app.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Request context ------------------------------------------------------------

CREATE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app.current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- SECURITY DEFINER so policies can read memberships without recursion.
CREATE FUNCTION app.current_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT role FROM app.memberships
  WHERE org_id = app.current_org_id() AND user_id = app.current_user_id()
$$;

CREATE FUNCTION app.plan_limit(p text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'pro' THEN 1000 ELSE 30 END
$$;

-- Row-level security ----------------------------------------------------------

ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invoice_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.export_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vendor_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_read ON app.organizations FOR SELECT
  USING (id = app.current_org_id() AND app.current_role() IS NOT NULL);

CREATE POLICY users_read ON app.users FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.memberships m
                 WHERE m.user_id = users.id AND m.org_id = app.current_org_id())
         AND app.current_role() IS NOT NULL);

CREATE POLICY members_read ON app.memberships FOR SELECT
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL);
CREATE POLICY members_admin_update ON app.memberships FOR UPDATE
  USING (org_id = app.current_org_id() AND app.current_role() = 'admin')
  WITH CHECK (org_id = app.current_org_id());

CREATE POLICY invoices_read ON app.invoices FOR SELECT
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL);
CREATE POLICY invoices_insert ON app.invoices FOR INSERT
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() IS NOT NULL
              AND uploaded_by = app.current_user_id() AND status = 'uploaded');
CREATE POLICY invoices_update ON app.invoices FOR UPDATE
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL)
  WITH CHECK (org_id = app.current_org_id());

CREATE POLICY files_read ON app.invoice_files FOR SELECT
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL);
CREATE POLICY files_insert ON app.invoice_files FOR INSERT
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() IS NOT NULL
              AND EXISTS (SELECT 1 FROM app.invoices i
                          WHERE i.id = invoice_id AND i.org_id = app.current_org_id()));

CREATE POLICY batches_read ON app.export_batches FOR SELECT
  USING (org_id = app.current_org_id() AND app.current_role() = 'admin');
CREATE POLICY batches_insert ON app.export_batches FOR INSERT
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() = 'admin'
              AND created_by = app.current_user_id());

CREATE POLICY vendors_rw ON app.vendor_accounts FOR ALL
  USING (org_id = app.current_org_id() AND app.current_role() IS NOT NULL)
  WITH CHECK (org_id = app.current_org_id() AND app.current_role() IS NOT NULL);

CREATE POLICY audit_read ON app.audit_log FOR SELECT
  USING (org_id = app.current_org_id()
         AND (app.current_role() = 'admin'
              OR (invoice_id IS NOT NULL AND app.current_role() IS NOT NULL)));

-- app_user gets only what the policies above need. No DELETE anywhere and no
-- UPDATE on audit_log: the audit trail is append-only by privilege.
GRANT USAGE ON SCHEMA app TO app_user;
GRANT SELECT (id, email, name, created_at) ON app.users TO app_user;
GRANT SELECT ON app.organizations, app.memberships, app.invoices,
  app.invoice_files, app.export_batches, app.vendor_accounts, app.audit_log TO app_user;
GRANT INSERT ON app.invoices, app.invoice_files, app.export_batches, app.vendor_accounts TO app_user;
GRANT UPDATE (status, data, issues, account, warning_note, reject_reason, extraction_meta,
  ai_data, registration_number, invoice_number, total_amount, submitted_by, approved_by,
  export_batch_id, extraction_count, updated_at) ON app.invoices TO app_user;
GRANT UPDATE (account) ON app.vendor_accounts TO app_user;
GRANT UPDATE (role) ON app.memberships TO app_user;
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.current_org_id(), app.current_role(),
  app.plan_limit(text) TO app_user;

-- Workflow guard ---------------------------------------------------------------

CREATE FUNCTION app.invoice_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r text := app.current_role();
  me uuid := app.current_user_id();
BEGIN
  IF r IS NULL THEN
    RAISE EXCEPTION 'not a member of this organization' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'exported' THEN
    RAISE EXCEPTION 'exported invoices are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.org_id <> OLD.org_id OR NEW.uploaded_by <> OLD.uploaded_by
     OR NEW.file_sha256 <> OLD.file_sha256 THEN
    RAISE EXCEPTION 'immutable invoice columns' USING ERRCODE = '42501';
  END IF;
  -- Who submitted, approved and exported, and the notes that go with it, change
  -- only in the transition that owns them (otherwise an approver could rewrite
  -- submitted_by on their own request and then approve it).
  IF ((NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
       OR NEW.warning_note IS DISTINCT FROM OLD.warning_note)
      AND NOT (NEW.status = 'submitted' AND OLD.status <> 'submitted'))
     OR (NEW.approved_by IS DISTINCT FROM OLD.approved_by
         AND NOT (NEW.status = 'approved' AND OLD.status = 'submitted'))
     OR (NEW.reject_reason IS DISTINCT FROM OLD.reject_reason
         AND NOT (NEW.status IN ('submitted', 'rejected') AND NEW.status <> OLD.status))
     OR (NEW.export_batch_id IS DISTINCT FROM OLD.export_batch_id
         AND NOT (NEW.status = 'exported' AND OLD.status = 'approved'))
     OR NEW.extraction_count < OLD.extraction_count THEN
    RAISE EXCEPTION 'workflow columns change only with their transition' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = OLD.status THEN
    -- Edits to the extracted data are allowed only while under review.
    IF OLD.status NOT IN ('uploaded', 'reviewing', 'rejected')
       AND (NEW.data IS DISTINCT FROM OLD.data OR NEW.account IS DISTINCT FROM OLD.account) THEN
      RAISE EXCEPTION 'invoice is locked in status %', OLD.status USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  CASE
    WHEN OLD.status IN ('uploaded', 'reviewing', 'rejected') AND NEW.status = 'reviewing' THEN
      NULL;
    WHEN OLD.status IN ('reviewing', 'rejected') AND NEW.status = 'submitted' THEN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.issues) i WHERE i->>'severity' = 'error') THEN
        RAISE EXCEPTION 'cannot submit with validation errors' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.issues) i WHERE i->>'severity' = 'warning')
         AND coalesce(length(trim(NEW.warning_note)), 0) = 0 THEN
        RAISE EXCEPTION 'warnings require a note' USING ERRCODE = '23514';
      END IF;
      IF NEW.submitted_by IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'submitted_by must be the current user' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status = 'submitted' AND NEW.status IN ('approved', 'rejected') THEN
      IF r NOT IN ('approver', 'admin') THEN
        RAISE EXCEPTION 'only approvers can decide' USING ERRCODE = '42501';
      END IF;
      IF OLD.submitted_by = me THEN
        RAISE EXCEPTION 'self-approval is not allowed' USING ERRCODE = '42501';
      END IF;
      IF NEW.status = 'approved' AND NEW.approved_by IS DISTINCT FROM me THEN
        RAISE EXCEPTION 'approved_by must be the current user' USING ERRCODE = '42501';
      END IF;
      IF NEW.status = 'rejected' AND coalesce(length(trim(NEW.reject_reason)), 0) = 0 THEN
        RAISE EXCEPTION 'a rejection needs a reason' USING ERRCODE = '23514';
      END IF;
      IF NEW.data IS DISTINCT FROM OLD.data THEN
        RAISE EXCEPTION 'approvers cannot edit data' USING ERRCODE = '42501';
      END IF;
    WHEN OLD.status = 'approved' AND NEW.status = 'exported' THEN
      IF r <> 'admin' THEN
        RAISE EXCEPTION 'only admins export' USING ERRCODE = '42501';
      END IF;
      IF NEW.export_batch_id IS NULL OR NEW.data IS DISTINCT FROM OLD.data THEN
        RAISE EXCEPTION 'export needs a batch and unchanged data' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM app.export_batches b
                     WHERE b.id = NEW.export_batch_id AND b.org_id = NEW.org_id) THEN
        RAISE EXCEPTION 'export batch of another organization' USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END CASE;
  RETURN NEW;
END $$;

CREATE TRIGGER invoice_guard BEFORE UPDATE ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoice_guard();

-- Monthly quota by plan, counted per organization and calendar month (JST).
CREATE FUNCTION app.invoice_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  used integer;
  lim integer;
BEGIN
  SELECT app.plan_limit(plan) INTO lim FROM app.organizations WHERE id = NEW.org_id;
  SELECT count(*) INTO used FROM app.invoices
   WHERE org_id = NEW.org_id
     AND date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo')
         = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo');
  IF used >= lim THEN
    RAISE EXCEPTION 'monthly quota of % invoices reached', lim USING ERRCODE = '53400';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER invoice_quota BEFORE INSERT ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoice_quota();

-- Audit trail written by trigger so no code path can skip it.
CREATE FUNCTION app.invoice_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  changed jsonb := '{}';
  k text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app.audit_log (org_id, invoice_id, actor_id, action, detail)
    VALUES (NEW.org_id, NEW.id, app.current_user_id(), 'upload',
            jsonb_build_object('file_name', NEW.file_name));
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status THEN
    INSERT INTO app.audit_log (org_id, invoice_id, actor_id, action, detail)
    VALUES (NEW.org_id, NEW.id, app.current_user_id(), 'status:' || NEW.status,
            jsonb_strip_nulls(jsonb_build_object('from', OLD.status,
              'reason', CASE WHEN NEW.status = 'rejected' THEN NEW.reject_reason END,
              'warning_note', CASE WHEN NEW.status = 'submitted' THEN NEW.warning_note END)));
  END IF;
  IF NEW.data IS DISTINCT FROM OLD.data AND OLD.data IS NOT NULL THEN
    FOR k IN SELECT key FROM jsonb_object_keys(NEW.data) key LOOP
      IF NEW.data->k IS DISTINCT FROM OLD.data->k THEN
        changed := changed || jsonb_build_object(k, jsonb_build_object('from', OLD.data->k, 'to', NEW.data->k));
      END IF;
    END LOOP;
    INSERT INTO app.audit_log (org_id, invoice_id, actor_id, action, detail)
    VALUES (NEW.org_id, NEW.id, app.current_user_id(), 'edit', changed);
  END IF;
  IF NEW.account IS DISTINCT FROM OLD.account AND OLD.account IS NOT NULL THEN
    INSERT INTO app.audit_log (org_id, invoice_id, actor_id, action, detail)
    VALUES (NEW.org_id, NEW.id, app.current_user_id(), 'account',
            jsonb_build_object('from', OLD.account, 'to', NEW.account));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER invoice_audit_insert AFTER INSERT ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoice_audit();
CREATE TRIGGER invoice_audit_update AFTER UPDATE ON app.invoices
  FOR EACH ROW EXECUTE FUNCTION app.invoice_audit();

CREATE FUNCTION app.membership_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NEW.role <> OLD.role THEN
    INSERT INTO app.audit_log (org_id, actor_id, action, detail)
    VALUES (NEW.org_id, app.current_user_id(), 'role',
            jsonb_build_object('user_id', NEW.user_id, 'from', OLD.role, 'to', NEW.role));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_audit AFTER UPDATE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION app.membership_audit();

-- An admin cannot remove the last admin (including themselves).
CREATE FUNCTION app.membership_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF OLD.role = 'admin' AND NEW.role <> 'admin' AND
     (SELECT count(*) FROM app.memberships WHERE org_id = OLD.org_id AND role = 'admin') <= 1 THEN
    RAISE EXCEPTION 'an organization needs at least one admin' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_guard BEFORE UPDATE ON app.memberships
  FOR EACH ROW EXECUTE FUNCTION app.membership_guard();

CREATE FUNCTION app.export_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  INSERT INTO app.audit_log (org_id, actor_id, action, detail)
  VALUES (NEW.org_id, NEW.created_by, 'export',
          jsonb_build_object('batch_id', NEW.id, 'invoice_count', NEW.invoice_count));
  RETURN NEW;
END $$;
CREATE TRIGGER export_audit AFTER INSERT ON app.export_batches
  FOR EACH ROW EXECUTE FUNCTION app.export_audit();

-- Authentication: app_user never reads password hashes or sessions directly.
CREATE FUNCTION app.auth_lookup(p_email text)
RETURNS TABLE (user_id uuid, password_hash text, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT u.id, u.password_hash,
         (SELECT m.org_id FROM app.memberships m WHERE m.user_id = u.id ORDER BY m.org_id LIMIT 1)
  FROM app.users u WHERE u.email = lower(p_email)
$$;

CREATE FUNCTION app.auth_create_session(p_token_hash text, p_user uuid, p_org uuid, p_ttl interval)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.memberships WHERE user_id = p_user AND org_id = p_org) THEN
    RAISE EXCEPTION 'not a member' USING ERRCODE = '42501';
  END IF;
  IF p_ttl > interval '7 days' THEN
    RAISE EXCEPTION 'session too long' USING ERRCODE = '22023';
  END IF;
  DELETE FROM app.sessions WHERE expires_at < now();
  INSERT INTO app.sessions (token_hash, user_id, org_id, expires_at)
  VALUES (p_token_hash, p_user, p_org, now() + p_ttl);
END $$;

CREATE FUNCTION app.auth_session(p_token_hash text)
RETURNS TABLE (user_id uuid, org_id uuid, role text, user_name text, email text, org_name text, plan text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT s.user_id, s.org_id, m.role, u.name, u.email, o.name, o.plan
  FROM app.sessions s
  JOIN app.memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
  JOIN app.users u ON u.id = s.user_id
  JOIN app.organizations o ON o.id = s.org_id
  WHERE s.token_hash = p_token_hash AND s.expires_at > now()
$$;

CREATE FUNCTION app.auth_delete_session(p_token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  DELETE FROM app.sessions WHERE token_hash = p_token_hash
$$;

-- Billing: called only after the application verified the Stripe signature.
-- Returns false when the event was already processed (idempotency). Stripe does
-- not deliver events in order, so an event older than the one that last changed
-- the plan is recorded but not applied.
CREATE FUNCTION app.billing_apply(p_event_id text, p_type text, p_org uuid,
                                  p_plan text, p_customer text,
                                  p_created timestamptz DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  changed uuid;
BEGIN
  INSERT INTO app.stripe_events (id, type) VALUES (p_event_id, p_type)
  ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_plan NOT IN ('free', 'pro') THEN
    RAISE EXCEPTION 'unknown plan' USING ERRCODE = '22023';
  END IF;
  UPDATE app.organizations
     SET plan = p_plan,
         stripe_customer_id = coalesce(p_customer, stripe_customer_id),
         plan_event_at = coalesce(p_created, plan_event_at)
   WHERE (id = p_org OR (p_org IS NULL AND stripe_customer_id = p_customer))
     AND (p_created IS NULL OR plan_event_at IS NULL OR p_created >= plan_event_at)
  RETURNING id INTO changed;
  IF changed IS NOT NULL THEN
    INSERT INTO app.audit_log (org_id, action, detail)
    VALUES (changed, 'billing', jsonb_build_object('event', p_type, 'plan', p_plan));
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION app.monthly_usage() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT count(*)::integer FROM app.invoices
   WHERE org_id = app.current_org_id() AND app.current_role() IS NOT NULL
     AND date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo')
         = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo')
$$;

REVOKE ALL ON FUNCTION app.auth_lookup(text), app.auth_create_session(text, uuid, uuid, interval),
  app.auth_session(text), app.auth_delete_session(text),
  app.billing_apply(text, text, uuid, text, text, timestamptz), app.monthly_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_lookup(text), app.auth_create_session(text, uuid, uuid, interval),
  app.auth_session(text), app.auth_delete_session(text),
  app.billing_apply(text, text, uuid, text, text, timestamptz), app.monthly_usage() TO app_user;
