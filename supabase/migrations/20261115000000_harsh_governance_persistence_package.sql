-- ============================================================================
-- IDENTIQ MASTER PERSISTENCE & GOVERNANCE MIGRATION PACKAGE
-- ============================================================================
-- Modules: Dashboard, Activity Timeline, Audit History, Reporting & Export
-- Author: Harsh Joshi (Lead Governance & Persistence Engineer)
-- Reviewer: Bhumi (Lead Database Architect & Schema Owner)
-- Target: Hosted Supabase PostgreSQL Project
-- Scope: 100% Additive & Non-Destructive
--
-- NON-NEGOTIABLE SAFETY INVARIANTS:
-- 1. Does NOT drop, alter, truncate, or recreate Bhumi's existing tables:
--    (organisations, brands, brand_rules, brand_facts, assets, audit_logs).
-- 2. Strictly isolates review lifecycle telemetry into activity_events.
--    Does NOT write review lifecycle events into Bhumi's audit_logs.
-- 3. Idempotent: Uses IF NOT EXISTS, CREATE OR REPLACE, and DROP POLICY IF EXISTS.
-- 4. Secure: All helper functions and RPCs are SECURITY DEFINER with fixed search_path.
-- 5. Role Hierarchy: owner > admin > reviewer > contributor.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. ORGANISATION MEMBERSHIP & TENANCY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organisation_members (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'reviewer', 'contributor')),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT organisation_members_pkey PRIMARY KEY (id),
    CONSTRAINT organisation_members_org_user_uniq UNIQUE (organisation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organisation_members_user ON public.organisation_members (user_id);
CREATE INDEX IF NOT EXISTS idx_organisation_members_org_role ON public.organisation_members (organisation_id, role);

-- ----------------------------------------------------------------------------
-- 2. TENANCY HELPER FUNCTIONS (Non-Recursive RLS Helpers)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
STABLE
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.organisation_members
        WHERE organisation_id = p_org_id
          AND user_id = auth.uid()
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_org_role(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
STABLE
AS $$
DECLARE
    v_role text;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT role INTO v_role
    FROM public.organisation_members
    WHERE organisation_id = p_org_id
      AND user_id = auth.uid();
    RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(p_org_id uuid, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
STABLE
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN false;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.organisation_members
        WHERE organisation_id = p_org_id
          AND user_id = auth.uid()
          AND (
              role = p_role OR
              (p_role = 'admin' AND role = 'owner') OR
              (p_role = 'reviewer' AND role IN ('owner', 'admin')) OR
              (p_role = 'contributor' AND role IN ('owner', 'admin', 'reviewer'))
          )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_org_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_org_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. MEMBERSHIP INTEGRITY & PRIVILEGE ESCALATION TRIGGER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_enforce_organisation_members_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_target_org_id uuid;
    v_caller_role text;
    v_owner_count integer;
    v_member_count integer;
BEGIN
    v_target_org_id := COALESCE(NEW.organisation_id, OLD.organisation_id);

    -- Concurrency serialization: lock target organisation row
    PERFORM 1 FROM public.organisations WHERE id = v_target_org_id FOR UPDATE;

    -- Anti-self-role modification: a caller cannot modify their own role
    IF TG_OP = 'UPDATE' AND OLD.user_id = auth.uid() AND NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Users cannot modify their own role' USING ERRCODE = '42501';
    END IF;

    -- Check caller role if authenticated
    IF auth.uid() IS NOT NULL THEN
        SELECT role INTO v_caller_role
        FROM public.organisation_members
        WHERE organisation_id = v_target_org_id
          AND user_id = auth.uid();

        SELECT count(*) INTO v_member_count
        FROM public.organisation_members
        WHERE organisation_id = v_target_org_id;

        -- Non-owners cannot assign or promote anyone to 'owner' or 'admin'
        -- Exception: initial bootstrap of the first owner on an organisation with 0 members
        IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.role IN ('owner', 'admin') AND (v_caller_role IS NULL OR v_caller_role != 'owner') THEN
            IF NOT (TG_OP = 'INSERT' AND v_member_count = 0 AND NEW.role = 'owner' AND NEW.user_id = auth.uid()) THEN
                RAISE EXCEPTION 'Only organisation owners can assign owner or admin roles' USING ERRCODE = '42501';
            END IF;
        END IF;

        -- Admins cannot delete or demote owners or other admins
        IF TG_OP = 'DELETE' AND OLD.role IN ('owner', 'admin') AND (v_caller_role IS NULL OR v_caller_role != 'owner') AND OLD.user_id != auth.uid() THEN
            RAISE EXCEPTION 'Only organisation owners can remove owners or admins' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Sole owner protection (both on demotion and removal)
    IF (TG_OP = 'DELETE' AND OLD.role = 'owner') OR
       (TG_OP = 'UPDATE' AND OLD.role = 'owner' AND NEW.role != 'owner') THEN
        SELECT count(*) INTO v_owner_count
        FROM public.organisation_members
        WHERE organisation_id = v_target_org_id
          AND role = 'owner';

        IF v_owner_count <= 1 THEN
            RAISE EXCEPTION 'Cannot demote or remove the sole owner of an organisation' USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_organisation_members_rules ON public.organisation_members;
CREATE TRIGGER trg_organisation_members_rules
    BEFORE INSERT OR UPDATE OR DELETE ON public.organisation_members
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_enforce_organisation_members_rules();

-- ----------------------------------------------------------------------------
-- 4. FIRST-OWNER PROVISIONING RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organisation_and_owner(
    p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_user_id uuid;
    v_org_id uuid;
    v_brand_id uuid;
    v_clean_name text;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Caller must be authenticated' USING ERRCODE = '42501';
    END IF;

    v_clean_name := trim(p_name);
    IF length(v_clean_name) < 2 OR length(v_clean_name) > 100 THEN
        RAISE EXCEPTION 'Organisation name must be between 2 and 100 characters' USING ERRCODE = '22023';
    END IF;

    -- Create organisation using only existing deployed column 'name'
    INSERT INTO public.organisations (name)
    VALUES (v_clean_name)
    RETURNING id INTO v_org_id;

    -- Create initial owner membership
    INSERT INTO public.organisation_members (organisation_id, user_id, role)
    VALUES (v_org_id, v_user_id, 'owner');

    -- Create default primary brand for the organisation
    INSERT INTO public.brands (organisation_id, name, approved)
    VALUES (v_org_id, v_clean_name, true)
    RETURNING id INTO v_brand_id;

    RETURN jsonb_build_object(
        'organisation_id', v_org_id,
        'brand_id', v_brand_id,
        'name', v_clean_name,
        'role', 'owner'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_organisation_and_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organisation_and_owner(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. RLS POLICIES FOR BASE TENANCY TABLES
-- ----------------------------------------------------------------------------
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

-- organisations policies
DROP POLICY IF EXISTS organisations_select_policy ON public.organisations;
CREATE POLICY organisations_select_policy ON public.organisations
    FOR SELECT TO authenticated
    USING (public.is_org_member(id));

DROP POLICY IF EXISTS organisations_update_policy ON public.organisations;
CREATE POLICY organisations_update_policy ON public.organisations
    FOR UPDATE TO authenticated
    USING (public.has_org_role(id, 'owner'))
    WITH CHECK (public.has_org_role(id, 'owner'));

-- organisation_members policies
DROP POLICY IF EXISTS org_members_select_policy ON public.organisation_members;
CREATE POLICY org_members_select_policy ON public.organisation_members
    FOR SELECT TO authenticated
    USING (public.is_org_member(organisation_id));

DROP POLICY IF EXISTS org_members_insert_policy ON public.organisation_members;
CREATE POLICY org_members_insert_policy ON public.organisation_members
    FOR INSERT TO authenticated
    WITH CHECK (
        public.has_org_role(organisation_id, 'owner') OR
        (public.has_org_role(organisation_id, 'admin') AND role IN ('reviewer', 'contributor'))
    );

DROP POLICY IF EXISTS org_members_update_policy ON public.organisation_members;
CREATE POLICY org_members_update_policy ON public.organisation_members
    FOR UPDATE TO authenticated
    USING (public.has_org_role(organisation_id, 'owner'))
    WITH CHECK (public.has_org_role(organisation_id, 'owner'));

DROP POLICY IF EXISTS org_members_delete_policy ON public.organisation_members;
CREATE POLICY org_members_delete_policy ON public.organisation_members
    FOR DELETE TO authenticated
    USING (
        public.has_org_role(organisation_id, 'owner') OR
        (user_id = auth.uid() AND public.is_org_member(organisation_id))
    );

-- brands policies
DROP POLICY IF EXISTS brands_select_policy ON public.brands;
CREATE POLICY brands_select_policy ON public.brands
    FOR SELECT TO authenticated
    USING (public.is_org_member(organisation_id));

DROP POLICY IF EXISTS brands_insert_policy ON public.brands;
CREATE POLICY brands_insert_policy ON public.brands
    FOR INSERT TO authenticated
    WITH CHECK (public.is_org_member(organisation_id));

DROP POLICY IF EXISTS brands_update_policy ON public.brands;
CREATE POLICY brands_update_policy ON public.brands
    FOR UPDATE TO authenticated
    USING (public.has_org_role(organisation_id, 'admin'))
    WITH CHECK (public.has_org_role(organisation_id, 'admin'));

DROP POLICY IF EXISTS brands_delete_policy ON public.brands;
CREATE POLICY brands_delete_policy ON public.brands
    FOR DELETE TO authenticated
    USING (public.has_org_role(organisation_id, 'owner'));

-- Base Grants
REVOKE ALL ON TABLE public.organisations FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.organisation_members FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.organisations TO authenticated;
GRANT UPDATE (name) ON TABLE public.organisations TO authenticated;
REVOKE INSERT, DELETE ON TABLE public.organisations FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organisation_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brands TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. REVIEW GOVERNANCE TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reviews (
    id text NOT NULL,
    organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
    title text NOT NULL,
    content_type text NOT NULL,
    guideline_collection text NOT NULL,
    submitted_by text NOT NULL,
    submitted_at timestamp with time zone NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'Pending Approval' CHECK (status IN ('Pending Approval', 'In Review', 'Changes Requested', 'Approved')),
    compliance_score integer NOT NULL DEFAULT 100,
    base_score integer NOT NULL DEFAULT 100,
    text_content text NOT NULL DEFAULT '',
    asset_url text,
    asset_name text,
    pastel_theme text NOT NULL DEFAULT 'blue',
    reviewer_notes text,
    provider_used text,
    fallback_used boolean DEFAULT false,
    analysis_status text DEFAULT 'COMPLETED',
    analysis_run_id text,
    visual_summary jsonb,
    ocr_blocks jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT reviews_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_org ON public.reviews (organisation_id);
CREATE INDEX IF NOT EXISTS idx_reviews_brand ON public.reviews (brand_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON public.reviews (status);
CREATE INDEX IF NOT EXISTS idx_reviews_submitted_at ON public.reviews (submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.review_findings (
    id text NOT NULL,
    review_id text NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
    brand_rule_id uuid REFERENCES public.brand_rules(id) ON DELETE SET NULL,
    rule_id text,
    category text NOT NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    severity text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
    evidence_status text NOT NULL DEFAULT 'unverified' CHECK (evidence_status IN ('supported', 'conflicting', 'unverified')),
    detected_value text NOT NULL DEFAULT '',
    expected_value text NOT NULL DEFAULT '',
    source_reference text NOT NULL DEFAULT '',
    recommendation text NOT NULL DEFAULT '',
    affected_content text NOT NULL DEFAULT '',
    resolved boolean NOT NULL DEFAULT false,
    resolved_at timestamp with time zone,
    resolved_by text,
    edited_correction text,
    evidence_references jsonb,
    source_version_ids text[],
    location jsonb,
    confidence numeric,
    detector text,
    requires_human_review boolean DEFAULT false,
    source_domain text DEFAULT 'text',
    review_decision text CHECK (review_decision IS NULL OR review_decision IN ('APPROVE', 'REJECT', 'REQUEST_CHANGES', 'NEEDS_HUMAN_REVIEW')),
    review_decision_reason text,
    review_decision_at timestamp with time zone,
    review_decision_by text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT review_findings_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_review_findings_review ON public.review_findings (review_id);
CREATE INDEX IF NOT EXISTS idx_review_findings_severity ON public.review_findings (severity);
CREATE INDEX IF NOT EXISTS idx_review_findings_resolved ON public.review_findings (resolved);

CREATE TABLE IF NOT EXISTS public.review_comments (
    id text NOT NULL,
    review_id text NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
    finding_id text NOT NULL REFERENCES public.review_findings(id) ON DELETE CASCADE,
    author text NOT NULL,
    role text NOT NULL,
    text text NOT NULL,
    parent_comment_id text REFERENCES public.review_comments(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT review_comments_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_review_comments_finding ON public.review_comments (finding_id);
CREATE INDEX IF NOT EXISTS idx_review_comments_review ON public.review_comments (review_id);

CREATE TABLE IF NOT EXISTS public.activity_events (
    id text NOT NULL,
    organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    review_id text REFERENCES public.reviews(id) ON DELETE CASCADE,
    actor text NOT NULL,
    action text NOT NULL,
    target text NOT NULL,
    type text NOT NULL CHECK (type IN (
        'submitted',
        'resolved',
        'approved',
        'changes_requested',
        'correction_applied',
        'comment_added',
        'manual_finding_added',
        'finding_decision',
        'knowledge_updated',
        'asset_uploaded'
    )),
    timestamp timestamp with time zone NOT NULL DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT activity_events_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_activity_events_org ON public.activity_events (organisation_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_review ON public.activity_events (review_id);
CREATE INDEX IF NOT EXISTS idx_activity_events_timestamp ON public.activity_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_events_type ON public.activity_events (type);

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    operation_type text NOT NULL,
    key text NOT NULL,
    payload_hash text NOT NULL,
    status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed')),
    resource_id text,
    response_payload jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '24 hours'),
    CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id),
    CONSTRAINT idempotency_keys_org_user_op_key_uniq UNIQUE (organisation_id, user_id, operation_type, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lookup ON public.idempotency_keys (organisation_id, user_id, operation_type, key);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON public.idempotency_keys (expires_at);

-- ----------------------------------------------------------------------------
-- 7. RLS POLICIES & GRANTS FOR REVIEW GOVERNANCE TABLES
-- ----------------------------------------------------------------------------
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- reviews policies
DROP POLICY IF EXISTS reviews_select_policy ON public.reviews;
CREATE POLICY reviews_select_policy ON public.reviews
    FOR SELECT TO authenticated
    USING (public.is_org_member(organisation_id));

DROP POLICY IF EXISTS reviews_insert_policy ON public.reviews;
CREATE POLICY reviews_insert_policy ON public.reviews
    FOR INSERT TO authenticated
    WITH CHECK (public.is_org_member(organisation_id));

DROP POLICY IF EXISTS reviews_update_policy ON public.reviews;
CREATE POLICY reviews_update_policy ON public.reviews
    FOR UPDATE TO authenticated
    USING (public.is_org_member(organisation_id))
    WITH CHECK (public.is_org_member(organisation_id));

DROP POLICY IF EXISTS reviews_delete_policy ON public.reviews;
CREATE POLICY reviews_delete_policy ON public.reviews
    FOR DELETE TO authenticated
    USING (public.has_org_role(organisation_id, 'admin'));

-- review_findings policies
DROP POLICY IF EXISTS review_findings_select_policy ON public.review_findings;
CREATE POLICY review_findings_select_policy ON public.review_findings
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.reviews r
            WHERE r.id = review_findings.review_id
              AND public.is_org_member(r.organisation_id)
        )
    );

DROP POLICY IF EXISTS review_findings_insert_policy ON public.review_findings;
CREATE POLICY review_findings_insert_policy ON public.review_findings
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reviews r
            WHERE r.id = review_findings.review_id
              AND public.is_org_member(r.organisation_id)
        )
    );

DROP POLICY IF EXISTS review_findings_update_policy ON public.review_findings;
CREATE POLICY review_findings_update_policy ON public.review_findings
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.reviews r
            WHERE r.id = review_findings.review_id
              AND public.is_org_member(r.organisation_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reviews r
            WHERE r.id = review_findings.review_id
              AND public.is_org_member(r.organisation_id)
        )
    );

DROP POLICY IF EXISTS review_findings_delete_policy ON public.review_findings;
CREATE POLICY review_findings_delete_policy ON public.review_findings
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.reviews r
            WHERE r.id = review_findings.review_id
              AND public.has_org_role(r.organisation_id, 'admin')
        )
    );

-- review_comments policies
DROP POLICY IF EXISTS review_comments_select_policy ON public.review_comments;
CREATE POLICY review_comments_select_policy ON public.review_comments
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.reviews r
            WHERE r.id = review_comments.review_id
              AND public.is_org_member(r.organisation_id)
        )
    );

DROP POLICY IF EXISTS review_comments_insert_policy ON public.review_comments;
CREATE POLICY review_comments_insert_policy ON public.review_comments
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reviews r
            WHERE r.id = review_comments.review_id
              AND public.is_org_member(r.organisation_id)
        )
    );

-- activity_events policies
DROP POLICY IF EXISTS activity_events_select_policy ON public.activity_events;
CREATE POLICY activity_events_select_policy ON public.activity_events
    FOR SELECT TO authenticated
    USING (public.is_org_member(organisation_id));

DROP POLICY IF EXISTS activity_events_insert_policy ON public.activity_events;
CREATE POLICY activity_events_insert_policy ON public.activity_events
    FOR INSERT TO authenticated
    WITH CHECK (public.is_org_member(organisation_id));

-- idempotency_keys policies
DROP POLICY IF EXISTS idempotency_keys_select_policy ON public.idempotency_keys;
CREATE POLICY idempotency_keys_select_policy ON public.idempotency_keys
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() AND public.is_org_member(organisation_id));

DROP POLICY IF EXISTS idempotency_keys_insert_policy ON public.idempotency_keys;
CREATE POLICY idempotency_keys_insert_policy ON public.idempotency_keys
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND public.is_org_member(organisation_id));

DROP POLICY IF EXISTS idempotency_keys_update_policy ON public.idempotency_keys;
CREATE POLICY idempotency_keys_update_policy ON public.idempotency_keys
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() AND public.is_org_member(organisation_id))
    WITH CHECK (user_id = auth.uid() AND public.is_org_member(organisation_id));

-- Governance Grants
REVOKE ALL ON TABLE public.reviews FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.review_findings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.review_comments FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.activity_events FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.idempotency_keys FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.review_findings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.review_comments TO authenticated;
GRANT SELECT, INSERT ON TABLE public.activity_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.idempotency_keys TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. COMPLIANCE SCORE RECOMPUTATION HELPER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_review_score(p_review_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_base_score integer;
    v_finding_count integer;
    v_unresolved_penalty integer;
    v_new_score integer;
BEGIN
    SELECT base_score INTO v_base_score
    FROM public.reviews
    WHERE id = p_review_id;

    IF v_base_score IS NULL THEN
        RETURN 100;
    END IF;

    SELECT
        count(*),
        COALESCE(SUM(
            CASE
                WHEN resolved THEN 0
                WHEN severity = 'high' THEN 12
                WHEN severity = 'medium' THEN 6
                ELSE 3
            END
        ), 0)
    INTO v_finding_count, v_unresolved_penalty
    FROM public.review_findings
    WHERE review_id = p_review_id;

    IF v_finding_count = 0 THEN
        v_new_score := 100;
    ELSE
        v_new_score := GREATEST(40, LEAST(99, GREATEST(v_base_score, 98 - v_unresolved_penalty)));
    END IF;

    UPDATE public.reviews
    SET compliance_score = v_new_score,
        updated_at = clock_timestamp()
    WHERE id = p_review_id;

    RETURN v_new_score;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. THE SEVEN ATOMIC REVIEW GOVERNANCE RPCS
-- ----------------------------------------------------------------------------

-- 9.1 submit_review_atomic
CREATE OR REPLACE FUNCTION public.submit_review_atomic(
    p_idempotency_key text,
    p_review_id text,
    p_organisation_id uuid,
    p_brand_id uuid,
    p_title text,
    p_content_type text,
    p_guideline_collection text,
    p_text_content text DEFAULT '',
    p_compliance_score integer DEFAULT 100,
    p_pastel_theme text DEFAULT 'blue',
    p_submitted_by text DEFAULT NULL,
    p_asset_url text DEFAULT NULL,
    p_asset_name text DEFAULT NULL,
    p_reviewer_notes text DEFAULT NULL,
    p_provider_used text DEFAULT NULL,
    p_fallback_used boolean DEFAULT false,
    p_analysis_status text DEFAULT 'COMPLETED',
    p_analysis_run_id text DEFAULT NULL,
    p_visual_summary jsonb DEFAULT NULL,
    p_ocr_blocks jsonb DEFAULT NULL,
    p_findings jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id uuid;
    v_op_type constant text := 'submit_review';
    v_clean_title text;
    v_clean_text text;
    v_clean_submitter text;
    v_canonical_json text;
    v_payload_hash text;
    v_existing_status text;
    v_existing_hash text;
    v_existing_response jsonb;
    v_existing_expires timestamptz;
    v_f jsonb;
    v_result jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_org_member(p_organisation_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not a member of organisation %', p_organisation_id USING ERRCODE = '42501';
    END IF;

    v_clean_title := trim(p_title);
    IF length(v_clean_title) = 0 THEN
        RAISE EXCEPTION 'Review title cannot be empty' USING ERRCODE = '22023';
    END IF;
    v_clean_text := replace(trim(COALESCE(p_text_content, '')), E'\r\n', E'\n');
    v_clean_submitter := COALESCE(trim(p_submitted_by), 'Reviewer');

    v_canonical_json := jsonb_build_object(
        'asset_name', p_asset_name,
        'asset_url', p_asset_url,
        'brand_id', lower(p_brand_id::text),
        'compliance_score', p_compliance_score,
        'content_type', trim(p_content_type),
        'findings', p_findings,
        'guideline_collection', trim(p_guideline_collection),
        'organisation_id', lower(p_organisation_id::text),
        'pastel_theme', lower(trim(p_pastel_theme)),
        'review_id', trim(p_review_id),
        'submitted_by', v_clean_submitter,
        'text_content', v_clean_text,
        'title', v_clean_title
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    INSERT INTO public.idempotency_keys (
        organisation_id, user_id, operation_type, key, payload_hash, status, created_at, expires_at
    )
    VALUES (
        p_organisation_id, v_caller_id, v_op_type, p_idempotency_key, v_payload_hash, 'started', clock_timestamp(), clock_timestamp() + interval '24 hours'
    )
    ON CONFLICT (organisation_id, user_id, operation_type, key)
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT status, payload_hash, response_payload, expires_at
        INTO v_existing_status, v_existing_hash, v_existing_response, v_existing_expires
        FROM public.idempotency_keys
        WHERE organisation_id = p_organisation_id
          AND user_id = v_caller_id
          AND operation_type = v_op_type
          AND key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Key "%" was already used with a different request payload', p_idempotency_key
              USING ERRCODE = 'P0001',
                    DETAIL = jsonb_build_object('key', p_idempotency_key, 'operation', v_op_type)::text,
                    HINT = 'idempotency_payload_mismatch';
        END IF;

        IF v_existing_status = 'started' THEN
            RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS_OR_CORRUPT: Key "%" is committed in "started" state and cannot be re-executed', p_idempotency_key
              USING ERRCODE = '55P03',
                    HINT = 'idempotency_stuck_started';
        END IF;

        IF v_existing_expires <= clock_timestamp() THEN
            UPDATE public.idempotency_keys
            SET payload_hash = v_payload_hash,
                status = 'started',
                response_payload = NULL,
                created_at = clock_timestamp(),
                completed_at = NULL,
                expires_at = clock_timestamp() + interval '24 hours'
            WHERE organisation_id = p_organisation_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Business Mutation
    INSERT INTO public.reviews (
        id, organisation_id, brand_id, title, content_type, guideline_collection,
        submitted_by, submitted_at, status, compliance_score, base_score,
        text_content, asset_url, asset_name, pastel_theme, reviewer_notes,
        provider_used, fallback_used, analysis_status, analysis_run_id,
        visual_summary, ocr_blocks, created_at, updated_at
    )
    VALUES (
        trim(p_review_id), p_organisation_id, p_brand_id, v_clean_title, trim(p_content_type), trim(p_guideline_collection),
        v_clean_submitter, clock_timestamp(), 'Pending Approval', p_compliance_score, p_compliance_score,
        v_clean_text, p_asset_url, p_asset_name, lower(trim(p_pastel_theme)), p_reviewer_notes,
        p_provider_used, p_fallback_used, p_analysis_status, p_analysis_run_id,
        p_visual_summary, p_ocr_blocks, clock_timestamp(), clock_timestamp()
    );

    IF jsonb_array_length(p_findings) > 0 THEN
        FOR v_f IN SELECT * FROM jsonb_array_elements(p_findings)
        LOOP
            INSERT INTO public.review_findings (
                id, review_id, brand_rule_id, rule_id, category, title, description,
                severity, evidence_status, detected_value, expected_value, source_reference,
                recommendation, affected_content, resolved, created_at, updated_at
            )
            VALUES (
                v_f->>'id',
                trim(p_review_id),
                CASE WHEN (v_f->>'brand_rule_id') IS NOT NULL AND (v_f->>'brand_rule_id') ~ '^[0-9a-fA-F-]{36}$' THEN (v_f->>'brand_rule_id')::uuid ELSE NULL END,
                v_f->>'ruleId',
                COALESCE(v_f->>'category', 'Brand Claims'),
                COALESCE(v_f->>'title', 'Governance Finding'),
                COALESCE(v_f->>'description', ''),
                COALESCE(lower(v_f->>'severity'), 'medium'),
                COALESCE(lower(v_f->>'evidenceStatus'), 'unverified'),
                COALESCE(v_f->>'detectedValue', ''),
                COALESCE(v_f->>'expectedValue', ''),
                COALESCE(v_f->>'sourceReference', ''),
                COALESCE(v_f->>'recommendation', ''),
                COALESCE(v_f->>'affectedContent', ''),
                COALESCE((v_f->>'resolved')::boolean, false),
                clock_timestamp(),
                clock_timestamp()
            );
        END LOOP;
    END IF;

    -- Lifecycle activity event
    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        p_organisation_id,
        trim(p_review_id),
        v_clean_submitter,
        'submitted content for governance review:',
        v_clean_title,
        'submitted',
        clock_timestamp(),
        jsonb_build_object('compliance_score', p_compliance_score, 'content_type', trim(p_content_type))
    );

    v_result := jsonb_build_object(
        'success', true,
        'review_id', trim(p_review_id),
        'status', 'Pending Approval',
        'compliance_score', p_compliance_score
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = trim(p_review_id),
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = p_organisation_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- 9.2 update_review_status_atomic
CREATE OR REPLACE FUNCTION public.update_review_status_atomic(
    p_idempotency_key text,
    p_review_id text,
    p_status text,
    p_reviewer_notes text DEFAULT NULL,
    p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id uuid;
    v_op_type constant text := 'update_review_status';
    v_org_id uuid;
    v_current_status text;
    v_title text;
    v_actor text;
    v_canonical_json text;
    v_payload_hash text;
    v_existing_status text;
    v_existing_hash text;
    v_existing_response jsonb;
    v_existing_expires timestamptz;
    v_activity_type text;
    v_activity_action text;
    v_result jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT organisation_id, status, title INTO v_org_id, v_current_status, v_title
    FROM public.reviews
    WHERE id = trim(p_review_id)
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review with id "%" not found', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not a member of the owning organisation' USING ERRCODE = '42501';
    END IF;

    IF p_status NOT IN ('Pending Approval', 'In Review', 'Changes Requested', 'Approved') THEN
        RAISE EXCEPTION 'Invalid review status "%"', p_status USING ERRCODE = '22023';
    END IF;

    -- Parity state machine checks
    IF v_current_status = 'Approved' AND p_status != 'In Review' THEN
        RAISE EXCEPTION 'Approved reviews can only be transitioned back to "In Review"' USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'review_id', trim(p_review_id),
        'reviewer_notes', p_reviewer_notes,
        'status', trim(p_status)
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    INSERT INTO public.idempotency_keys (
        organisation_id, user_id, operation_type, key, payload_hash, status, created_at, expires_at
    )
    VALUES (
        v_org_id, v_caller_id, v_op_type, p_idempotency_key, v_payload_hash, 'started', clock_timestamp(), clock_timestamp() + interval '24 hours'
    )
    ON CONFLICT (organisation_id, user_id, operation_type, key)
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT status, payload_hash, response_payload, expires_at
        INTO v_existing_status, v_existing_hash, v_existing_response, v_existing_expires
        FROM public.idempotency_keys
        WHERE organisation_id = v_org_id
          AND user_id = v_caller_id
          AND operation_type = v_op_type
          AND key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Key "%" was already used with a different request payload', p_idempotency_key
              USING ERRCODE = 'P0001',
                    DETAIL = jsonb_build_object('key', p_idempotency_key, 'operation', v_op_type)::text;
        END IF;

        IF v_existing_status = 'started' THEN
            RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS_OR_CORRUPT: Key "%" is committed in "started" state and cannot be re-executed', p_idempotency_key
              USING ERRCODE = '55P03';
        END IF;

        IF v_existing_expires <= clock_timestamp() THEN
            UPDATE public.idempotency_keys
            SET payload_hash = v_payload_hash,
                status = 'started',
                response_payload = NULL,
                created_at = clock_timestamp(),
                completed_at = NULL,
                expires_at = clock_timestamp() + interval '24 hours'
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Business Mutation
    UPDATE public.reviews
    SET status = trim(p_status),
        reviewer_notes = COALESCE(p_reviewer_notes, reviewer_notes),
        updated_at = clock_timestamp()
    WHERE id = trim(p_review_id);

    IF p_status = 'Approved' THEN
        v_activity_type := 'approved';
        v_activity_action := 'approved submission:';
    ELSIF p_status = 'Changes Requested' THEN
        v_activity_type := 'changes_requested';
        v_activity_action := 'requested changes on';
    ELSE
        v_activity_type := 'resolved';
        v_activity_action := 'moved review status to ' || trim(p_status) || ' for';
    END IF;

    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        trim(p_review_id),
        v_actor,
        v_activity_action,
        v_title,
        v_activity_type,
        clock_timestamp(),
        jsonb_build_object('previous_status', v_current_status, 'new_status', trim(p_status))
    );

    v_result := jsonb_build_object(
        'success', true,
        'review_id', trim(p_review_id),
        'status', trim(p_status)
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = trim(p_review_id),
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- 9.3 toggle_finding_resolved_atomic
CREATE OR REPLACE FUNCTION public.toggle_finding_resolved_atomic(
    p_idempotency_key text,
    p_review_id text,
    p_finding_id text,
    p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id uuid;
    v_op_type constant text := 'toggle_finding_resolved';
    v_org_id uuid;
    v_title text;
    v_finding_title text;
    v_current_resolved boolean;
    v_new_resolved boolean;
    v_actor text;
    v_canonical_json text;
    v_payload_hash text;
    v_existing_status text;
    v_existing_hash text;
    v_existing_response jsonb;
    v_existing_expires timestamptz;
    v_new_score integer;
    v_result jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT organisation_id, title INTO v_org_id, v_title
    FROM public.reviews
    WHERE id = trim(p_review_id)
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review with id "%" not found', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not a member of the owning organisation' USING ERRCODE = '42501';
    END IF;

    SELECT resolved, title INTO v_current_resolved, v_finding_title
    FROM public.review_findings
    WHERE id = trim(p_finding_id) AND review_id = trim(p_review_id)
    FOR UPDATE;

    IF v_current_resolved IS NULL THEN
        RAISE EXCEPTION 'Finding with id "%" not found in review "%"', p_finding_id, p_review_id USING ERRCODE = 'P0002';
    END IF;

    v_new_resolved := NOT v_current_resolved;
    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'finding_id', trim(p_finding_id),
        'review_id', trim(p_review_id)
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    INSERT INTO public.idempotency_keys (
        organisation_id, user_id, operation_type, key, payload_hash, status, created_at, expires_at
    )
    VALUES (
        v_org_id, v_caller_id, v_op_type, p_idempotency_key, v_payload_hash, 'started', clock_timestamp(), clock_timestamp() + interval '24 hours'
    )
    ON CONFLICT (organisation_id, user_id, operation_type, key)
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT status, payload_hash, response_payload, expires_at
        INTO v_existing_status, v_existing_hash, v_existing_response, v_existing_expires
        FROM public.idempotency_keys
        WHERE organisation_id = v_org_id
          AND user_id = v_caller_id
          AND operation_type = v_op_type
          AND key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Key "%" was already used with a different request payload', p_idempotency_key
              USING ERRCODE = 'P0001',
                    DETAIL = jsonb_build_object('key', p_idempotency_key, 'operation', v_op_type)::text;
        END IF;

        IF v_existing_status = 'started' THEN
            RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS_OR_CORRUPT: Key "%" is committed in "started" state and cannot be re-executed', p_idempotency_key
              USING ERRCODE = '55P03';
        END IF;

        IF v_existing_expires <= clock_timestamp() THEN
            UPDATE public.idempotency_keys
            SET payload_hash = v_payload_hash,
                status = 'started',
                response_payload = NULL,
                created_at = clock_timestamp(),
                completed_at = NULL,
                expires_at = clock_timestamp() + interval '24 hours'
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Business Mutation
    UPDATE public.review_findings
    SET resolved = v_new_resolved,
        resolved_at = CASE WHEN v_new_resolved THEN clock_timestamp() ELSE NULL END,
        resolved_by = CASE WHEN v_new_resolved THEN v_actor ELSE NULL END,
        updated_at = clock_timestamp()
    WHERE id = trim(p_finding_id) AND review_id = trim(p_review_id);

    v_new_score := public.recompute_review_score(trim(p_review_id));

    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        trim(p_review_id),
        v_actor,
        CASE WHEN v_new_resolved THEN 'marked finding resolved in' ELSE 'reopened finding in' END,
        v_title,
        'resolved',
        clock_timestamp(),
        jsonb_build_object('finding_id', trim(p_finding_id), 'finding_title', v_finding_title, 'resolved', v_new_resolved)
    );

    v_result := jsonb_build_object(
        'success', true,
        'finding_id', trim(p_finding_id),
        'resolved', v_new_resolved,
        'compliance_score', v_new_score
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = trim(p_finding_id),
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- 9.4 apply_finding_correction_atomic
CREATE OR REPLACE FUNCTION public.apply_finding_correction_atomic(
    p_idempotency_key text,
    p_review_id text,
    p_finding_id text,
    p_edited_text text,
    p_apply_to_copy boolean DEFAULT false,
    p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id uuid;
    v_op_type constant text := 'apply_finding_correction';
    v_org_id uuid;
    v_title text;
    v_text_content text;
    v_finding_title text;
    v_affected_content text;
    v_clean_edited_text text;
    v_updated_text text;
    v_actor text;
    v_canonical_json text;
    v_payload_hash text;
    v_existing_status text;
    v_existing_hash text;
    v_existing_response jsonb;
    v_existing_expires timestamptz;
    v_new_score integer;
    v_result jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT organisation_id, title, text_content INTO v_org_id, v_title, v_text_content
    FROM public.reviews
    WHERE id = trim(p_review_id)
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review with id "%" not found', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not a member of the owning organisation' USING ERRCODE = '42501';
    END IF;

    SELECT title, affected_content INTO v_finding_title, v_affected_content
    FROM public.review_findings
    WHERE id = trim(p_finding_id) AND review_id = trim(p_review_id)
    FOR UPDATE;

    IF v_finding_title IS NULL THEN
        RAISE EXCEPTION 'Finding with id "%" not found in review "%"', p_finding_id, p_review_id USING ERRCODE = 'P0002';
    END IF;

    v_clean_edited_text := trim(p_edited_text);
    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'apply_to_copy', p_apply_to_copy,
        'edited_text', v_clean_edited_text,
        'finding_id', trim(p_finding_id),
        'review_id', trim(p_review_id)
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    INSERT INTO public.idempotency_keys (
        organisation_id, user_id, operation_type, key, payload_hash, status, created_at, expires_at
    )
    VALUES (
        v_org_id, v_caller_id, v_op_type, p_idempotency_key, v_payload_hash, 'started', clock_timestamp(), clock_timestamp() + interval '24 hours'
    )
    ON CONFLICT (organisation_id, user_id, operation_type, key)
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT status, payload_hash, response_payload, expires_at
        INTO v_existing_status, v_existing_hash, v_existing_response, v_existing_expires
        FROM public.idempotency_keys
        WHERE organisation_id = v_org_id
          AND user_id = v_caller_id
          AND operation_type = v_op_type
          AND key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Key "%" was already used with a different request payload', p_idempotency_key
              USING ERRCODE = 'P0001',
                    DETAIL = jsonb_build_object('key', p_idempotency_key, 'operation', v_op_type)::text;
        END IF;

        IF v_existing_status = 'started' THEN
            RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS_OR_CORRUPT: Key "%" is committed in "started" state and cannot be re-executed', p_idempotency_key
              USING ERRCODE = '55P03';
        END IF;

        IF v_existing_expires <= clock_timestamp() THEN
            UPDATE public.idempotency_keys
            SET payload_hash = v_payload_hash,
                status = 'started',
                response_payload = NULL,
                created_at = clock_timestamp(),
                completed_at = NULL,
                expires_at = clock_timestamp() + interval '24 hours'
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Business Mutation
    UPDATE public.review_findings
    SET edited_correction = v_clean_edited_text,
        resolved = CASE WHEN p_apply_to_copy THEN true ELSE resolved END,
        resolved_at = CASE WHEN p_apply_to_copy THEN clock_timestamp() ELSE resolved_at END,
        resolved_by = CASE WHEN p_apply_to_copy THEN v_actor ELSE resolved_by END,
        updated_at = clock_timestamp()
    WHERE id = trim(p_finding_id) AND review_id = trim(p_review_id);

    v_updated_text := v_text_content;
    IF p_apply_to_copy AND length(v_clean_edited_text) > 0 AND length(v_affected_content) > 0 THEN
        IF position(v_affected_content in v_updated_text) > 0 THEN
            v_updated_text := replace(v_updated_text, v_affected_content, v_clean_edited_text);
            UPDATE public.reviews
            SET text_content = v_updated_text,
                updated_at = clock_timestamp()
            WHERE id = trim(p_review_id);
        END IF;
    END IF;

    v_new_score := public.recompute_review_score(trim(p_review_id));

    IF p_apply_to_copy THEN
        INSERT INTO public.activity_events (
            id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
        )
        VALUES (
            'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
            v_org_id,
            trim(p_review_id),
            v_actor,
            'applied correction for "' || v_finding_title || '" in',
            v_title,
            'correction_applied',
            clock_timestamp(),
            jsonb_build_object('finding_id', trim(p_finding_id), 'edited_correction', v_clean_edited_text)
        );
    END IF;

    v_result := jsonb_build_object(
        'success', true,
        'finding_id', trim(p_finding_id),
        'compliance_score', v_new_score,
        'text_content', v_updated_text
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = trim(p_finding_id),
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- 9.5 update_finding_decision_atomic
CREATE OR REPLACE FUNCTION public.update_finding_decision_atomic(
    p_idempotency_key text,
    p_review_id text,
    p_finding_id text,
    p_decision text,
    p_reason text DEFAULT NULL,
    p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id uuid;
    v_op_type constant text := 'update_finding_decision';
    v_org_id uuid;
    v_title text;
    v_finding_title text;
    v_current_decision text;
    v_clean_decision text;
    v_clean_reason text;
    v_actor text;
    v_canonical_json text;
    v_payload_hash text;
    v_existing_status text;
    v_existing_hash text;
    v_existing_response jsonb;
    v_existing_expires timestamptz;
    v_result jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT organisation_id, title INTO v_org_id, v_title
    FROM public.reviews
    WHERE id = trim(p_review_id)
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review with id "%" not found', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not a member of the owning organisation' USING ERRCODE = '42501';
    END IF;

    SELECT title, review_decision INTO v_finding_title, v_current_decision
    FROM public.review_findings
    WHERE id = trim(p_finding_id) AND review_id = trim(p_review_id)
    FOR UPDATE;

    IF v_finding_title IS NULL THEN
        RAISE EXCEPTION 'Finding with id "%" not found in review "%"', p_finding_id, p_review_id USING ERRCODE = 'P0002';
    END IF;

    v_clean_decision := upper(trim(p_decision));
    IF v_clean_decision NOT IN ('APPROVE', 'REJECT', 'REQUEST_CHANGES', 'NEEDS_HUMAN_REVIEW') THEN
        RAISE EXCEPTION 'Invalid review decision "%"', p_decision USING ERRCODE = '22023';
    END IF;

    v_clean_reason := trim(p_reason);
    IF v_clean_decision = 'REJECT' AND (v_clean_reason IS NULL OR length(v_clean_reason) = 0) THEN
        RAISE EXCEPTION 'Rejection requires a documented justification reason' USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'decision', v_clean_decision,
        'finding_id', trim(p_finding_id),
        'reason', v_clean_reason,
        'review_id', trim(p_review_id)
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    INSERT INTO public.idempotency_keys (
        organisation_id, user_id, operation_type, key, payload_hash, status, created_at, expires_at
    )
    VALUES (
        v_org_id, v_caller_id, v_op_type, p_idempotency_key, v_payload_hash, 'started', clock_timestamp(), clock_timestamp() + interval '24 hours'
    )
    ON CONFLICT (organisation_id, user_id, operation_type, key)
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT status, payload_hash, response_payload, expires_at
        INTO v_existing_status, v_existing_hash, v_existing_response, v_existing_expires
        FROM public.idempotency_keys
        WHERE organisation_id = v_org_id
          AND user_id = v_caller_id
          AND operation_type = v_op_type
          AND key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Key "%" was already used with a different request payload', p_idempotency_key
              USING ERRCODE = 'P0001',
                    DETAIL = jsonb_build_object('key', p_idempotency_key, 'operation', v_op_type)::text;
        END IF;

        IF v_existing_status = 'started' THEN
            RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS_OR_CORRUPT: Key "%" is committed in "started" state and cannot be re-executed', p_idempotency_key
              USING ERRCODE = '55P03';
        END IF;

        IF v_existing_expires <= clock_timestamp() THEN
            UPDATE public.idempotency_keys
            SET payload_hash = v_payload_hash,
                status = 'started',
                response_payload = NULL,
                created_at = clock_timestamp(),
                completed_at = NULL,
                expires_at = clock_timestamp() + interval '24 hours'
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Business Mutation
    UPDATE public.review_findings
    SET review_decision = v_clean_decision,
        review_decision_reason = CASE WHEN length(v_clean_reason) > 0 THEN v_clean_reason ELSE NULL END,
        review_decision_at = clock_timestamp(),
        review_decision_by = v_actor,
        requires_human_review = CASE WHEN v_clean_decision IN ('NEEDS_HUMAN_REVIEW', 'REQUEST_CHANGES') THEN true ELSE false END,
        updated_at = clock_timestamp()
    WHERE id = trim(p_finding_id) AND review_id = trim(p_review_id);

    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        trim(p_review_id),
        v_actor,
        lower(v_clean_decision) || ' finding "' || v_finding_title || '" in',
        v_title,
        'finding_decision',
        clock_timestamp(),
        jsonb_build_object('finding_id', trim(p_finding_id), 'decision', v_clean_decision, 'reason', v_clean_reason)
    );

    v_result := jsonb_build_object(
        'success', true,
        'finding_id', trim(p_finding_id),
        'decision', v_clean_decision,
        'decision_by', v_actor
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = trim(p_finding_id),
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- 9.6 add_finding_comment_atomic
CREATE OR REPLACE FUNCTION public.add_finding_comment_atomic(
    p_idempotency_key text,
    p_comment_id text,
    p_review_id text,
    p_finding_id text,
    p_text text,
    p_author_name text DEFAULT NULL,
    p_author_role text DEFAULT NULL,
    p_parent_comment_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id uuid;
    v_op_type constant text := 'add_finding_comment';
    v_org_id uuid;
    v_title text;
    v_finding_title text;
    v_clean_text text;
    v_author text;
    v_role text;
    v_canonical_json text;
    v_payload_hash text;
    v_existing_status text;
    v_existing_hash text;
    v_existing_response jsonb;
    v_existing_expires timestamptz;
    v_result jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT organisation_id, title INTO v_org_id, v_title
    FROM public.reviews
    WHERE id = trim(p_review_id)
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review with id "%" not found', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not a member of the owning organisation' USING ERRCODE = '42501';
    END IF;

    SELECT title INTO v_finding_title
    FROM public.review_findings
    WHERE id = trim(p_finding_id) AND review_id = trim(p_review_id)
    FOR UPDATE;

    IF v_finding_title IS NULL THEN
        RAISE EXCEPTION 'Finding with id "%" not found in review "%"', p_finding_id, p_review_id USING ERRCODE = 'P0002';
    END IF;

    v_clean_text := trim(p_text);
    IF length(v_clean_text) = 0 THEN
        RAISE EXCEPTION 'Comment text cannot be empty' USING ERRCODE = '22023';
    END IF;

    v_author := COALESCE(trim(p_author_name), 'Reviewer');
    v_role := COALESCE(trim(p_author_role), 'Governance');

    v_canonical_json := jsonb_build_object(
        'author_name', v_author,
        'author_role', v_role,
        'comment_id', trim(p_comment_id),
        'finding_id', trim(p_finding_id),
        'parent_comment_id', p_parent_comment_id,
        'review_id', trim(p_review_id),
        'text', v_clean_text
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    INSERT INTO public.idempotency_keys (
        organisation_id, user_id, operation_type, key, payload_hash, status, created_at, expires_at
    )
    VALUES (
        v_org_id, v_caller_id, v_op_type, p_idempotency_key, v_payload_hash, 'started', clock_timestamp(), clock_timestamp() + interval '24 hours'
    )
    ON CONFLICT (organisation_id, user_id, operation_type, key)
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT status, payload_hash, response_payload, expires_at
        INTO v_existing_status, v_existing_hash, v_existing_response, v_existing_expires
        FROM public.idempotency_keys
        WHERE organisation_id = v_org_id
          AND user_id = v_caller_id
          AND operation_type = v_op_type
          AND key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Key "%" was already used with a different request payload', p_idempotency_key
              USING ERRCODE = 'P0001',
                    DETAIL = jsonb_build_object('key', p_idempotency_key, 'operation', v_op_type)::text;
        END IF;

        IF v_existing_status = 'started' THEN
            RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS_OR_CORRUPT: Key "%" is committed in "started" state and cannot be re-executed', p_idempotency_key
              USING ERRCODE = '55P03';
        END IF;

        IF v_existing_expires <= clock_timestamp() THEN
            UPDATE public.idempotency_keys
            SET payload_hash = v_payload_hash,
                status = 'started',
                response_payload = NULL,
                created_at = clock_timestamp(),
                completed_at = NULL,
                expires_at = clock_timestamp() + interval '24 hours'
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Business Mutation
    INSERT INTO public.review_comments (
        id, review_id, finding_id, author, role, text, parent_comment_id, created_at
    )
    VALUES (
        trim(p_comment_id),
        trim(p_review_id),
        trim(p_finding_id),
        v_author,
        v_role,
        v_clean_text,
        p_parent_comment_id,
        clock_timestamp()
    );

    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        trim(p_review_id),
        v_author,
        'commented on finding "' || v_finding_title || '" in',
        v_title,
        'comment_added',
        clock_timestamp(),
        jsonb_build_object('finding_id', trim(p_finding_id), 'comment_id', trim(p_comment_id))
    );

    v_result := jsonb_build_object(
        'success', true,
        'comment_id', trim(p_comment_id),
        'finding_id', trim(p_finding_id)
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = trim(p_comment_id),
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- 9.7 add_manual_finding_atomic
DROP FUNCTION IF EXISTS public.add_manual_finding_atomic(text, text, text, text, text, text, text, text, text, text, text, text, text) RESTRICT;
CREATE OR REPLACE FUNCTION public.add_manual_finding_atomic(
    p_idempotency_key text,
    p_finding_id text,
    p_review_id text,
    p_category text,
    p_title text,
    p_description text DEFAULT '',
    p_severity text DEFAULT 'medium',
    p_evidence_status text DEFAULT 'unverified',
    p_detected_value text DEFAULT '',
    p_expected_value text DEFAULT '',
    p_source_reference text DEFAULT '',
    p_recommendation text DEFAULT '',
    p_affected_content text DEFAULT '',
    p_brand_rule_id uuid DEFAULT NULL,
    p_rule_id text DEFAULT NULL,
    p_actor_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id uuid;
    v_op_type constant text := 'add_manual_finding';
    v_org_id uuid;
    v_title text;
    v_clean_title text;
    v_clean_severity text;
    v_clean_status text;
    v_actor text;
    v_canonical_json text;
    v_payload_hash text;
    v_existing_status text;
    v_existing_hash text;
    v_existing_response jsonb;
    v_existing_expires timestamptz;
    v_new_score integer;
    v_result jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT organisation_id, title INTO v_org_id, v_title
    FROM public.reviews
    WHERE id = trim(p_review_id)
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review with id "%" not found', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not a member of the owning organisation' USING ERRCODE = '42501';
    END IF;

    v_clean_title := trim(p_title);
    IF length(v_clean_title) = 0 THEN
        RAISE EXCEPTION 'Finding title cannot be empty' USING ERRCODE = '22023';
    END IF;

    v_clean_severity := lower(trim(p_severity));
    IF v_clean_severity NOT IN ('high', 'medium', 'low') THEN
        RAISE EXCEPTION 'Invalid finding severity "%"', p_severity USING ERRCODE = '22023';
    END IF;

    v_clean_status := lower(trim(p_evidence_status));
    IF v_clean_status NOT IN ('supported', 'conflicting', 'unverified') THEN
        RAISE EXCEPTION 'Invalid evidence status "%"', p_evidence_status USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'affected_content', COALESCE(p_affected_content, ''),
        'brand_rule_id', p_brand_rule_id,
        'category', trim(p_category),
        'description', COALESCE(p_description, ''),
        'detected_value', COALESCE(p_detected_value, ''),
        'evidence_status', v_clean_status,
        'expected_value', COALESCE(p_expected_value, ''),
        'finding_id', trim(p_finding_id),
        'recommendation', COALESCE(p_recommendation, ''),
        'review_id', trim(p_review_id),
        'rule_id', p_rule_id,
        'severity', v_clean_severity,
        'source_reference', COALESCE(p_source_reference, ''),
        'title', v_clean_title
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    INSERT INTO public.idempotency_keys (
        organisation_id, user_id, operation_type, key, payload_hash, status, created_at, expires_at
    )
    VALUES (
        v_org_id, v_caller_id, v_op_type, p_idempotency_key, v_payload_hash, 'started', clock_timestamp(), clock_timestamp() + interval '24 hours'
    )
    ON CONFLICT (organisation_id, user_id, operation_type, key)
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT status, payload_hash, response_payload, expires_at
        INTO v_existing_status, v_existing_hash, v_existing_response, v_existing_expires
        FROM public.idempotency_keys
        WHERE organisation_id = v_org_id
          AND user_id = v_caller_id
          AND operation_type = v_op_type
          AND key = p_idempotency_key
        FOR UPDATE;

        IF v_existing_hash IS DISTINCT FROM v_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Key "%" was already used with a different request payload', p_idempotency_key
              USING ERRCODE = 'P0001',
                    DETAIL = jsonb_build_object('key', p_idempotency_key, 'operation', v_op_type)::text;
        END IF;

        IF v_existing_status = 'started' THEN
            RAISE EXCEPTION 'IDEMPOTENCY_IN_PROGRESS_OR_CORRUPT: Key "%" is committed in "started" state and cannot be re-executed', p_idempotency_key
              USING ERRCODE = '55P03';
        END IF;

        IF v_existing_expires <= clock_timestamp() THEN
            UPDATE public.idempotency_keys
            SET payload_hash = v_payload_hash,
                status = 'started',
                response_payload = NULL,
                created_at = clock_timestamp(),
                completed_at = NULL,
                expires_at = clock_timestamp() + interval '24 hours'
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Business Mutation
    INSERT INTO public.review_findings (
        id, review_id, brand_rule_id, rule_id, category, title, description,
        severity, evidence_status, detected_value, expected_value, source_reference,
        recommendation, affected_content, resolved, created_at, updated_at
    )
    VALUES (
        trim(p_finding_id),
        trim(p_review_id),
        p_brand_rule_id,
        p_rule_id,
        trim(p_category),
        v_clean_title,
        COALESCE(p_description, ''),
        v_clean_severity,
        v_clean_status,
        COALESCE(p_detected_value, ''),
        COALESCE(p_expected_value, ''),
        COALESCE(p_source_reference, ''),
        COALESCE(p_recommendation, ''),
        COALESCE(p_affected_content, ''),
        false,
        clock_timestamp(),
        clock_timestamp()
    );

    v_new_score := public.recompute_review_score(trim(p_review_id));

    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        trim(p_review_id),
        v_actor,
        'added manual finding "' || v_clean_title || '" to',
        v_title,
        'manual_finding_added',
        clock_timestamp(),
        jsonb_build_object('finding_id', trim(p_finding_id), 'severity', v_clean_severity, 'category', trim(p_category))
    );

    v_result := jsonb_build_object(
        'success', true,
        'finding_id', trim(p_finding_id),
        'compliance_score', v_new_score
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = trim(p_finding_id),
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. RPC EXECUTION GRANTS
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.submit_review_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_review_status_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_finding_resolved_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_finding_correction_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_finding_decision_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_finding_comment_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_manual_finding_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_review_score FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_review_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_review_status_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_finding_resolved_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_finding_correction_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_finding_decision_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_finding_comment_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_manual_finding_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_review_score TO authenticated;

COMMIT;
