-- Migration: 20261114170000_review_governance_schema.sql
-- Description: Create reviews, review_findings, review_comments, activity_events, and idempotency_keys with RLS.
-- Author: Harsh Joshi (Governance & Persistence)

-- 1. Create reviews table
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

-- 2. Create review_findings table
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

-- 3. Create review_comments table
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

-- 4. Create activity_events table
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

-- 5. Create idempotency_keys table
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

-- 6. Enable Row Level Security
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- 7. Define RLS policies

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

-- 8. Grants and Revocations
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
