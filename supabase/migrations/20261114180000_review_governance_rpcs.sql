-- Migration: 20261114180000_review_governance_rpcs.sql
-- Description: Implement the seven atomic review governance RPCs with single-transaction reservation-first idempotency.
-- Author: Harsh Joshi (Governance & Persistence)

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ============================================================================
-- HELPER: Recompute review compliance score
-- ============================================================================
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

-- ============================================================================
-- 1. RPC: submit_review_atomic
-- ============================================================================
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

    -- Parity normalization
    v_clean_title := trim(p_title);
    IF length(v_clean_title) = 0 THEN
        RAISE EXCEPTION 'Review title cannot be empty' USING ERRCODE = '22023';
    END IF;
    v_clean_text := replace(trim(COALESCE(p_text_content, '')), E'\r\n', E'\n');
    v_clean_submitter := COALESCE(trim(p_submitted_by), 'Reviewer');

    -- Build canonical JSON with lexicographically sorted keys
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

    -- Attempt reservation
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
            -- In-place reuse for expired completed record
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

    -- Business Mutation: Insert review
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

    -- Insert findings if provided
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

    -- Record lifecycle activity event
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

    -- Format result payload
    v_result := jsonb_build_object(
        'success', true,
        'review_id', trim(p_review_id),
        'status', 'Pending Approval',
        'compliance_score', p_compliance_score
    );

    -- Mark idempotency completed
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

-- ============================================================================
-- 2. RPC: update_review_status_atomic
-- ============================================================================
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
    v_event_type text;
    v_event_action text;
    v_result jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT organisation_id, status, title INTO v_org_id, v_current_status, v_title
    FROM public.reviews
    WHERE id = p_review_id
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review not found: %', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not an organisation member' USING ERRCODE = '42501';
    END IF;

    -- Validate state transitions
    IF v_current_status = 'Pending Approval' AND p_status NOT IN ('In Review', 'Changes Requested', 'Approved') THEN
        RAISE EXCEPTION 'Invalid status transition from "%" to "%"', v_current_status, p_status USING ERRCODE = '22023';
    ELSIF v_current_status = 'In Review' AND p_status NOT IN ('Changes Requested', 'Approved') THEN
        RAISE EXCEPTION 'Invalid status transition from "%" to "%"', v_current_status, p_status USING ERRCODE = '22023';
    ELSIF v_current_status = 'Changes Requested' AND p_status NOT IN ('In Review', 'Approved') THEN
        RAISE EXCEPTION 'Invalid status transition from "%" to "%"', v_current_status, p_status USING ERRCODE = '22023';
    ELSIF v_current_status = 'Approved' AND p_status NOT IN ('In Review') THEN
        RAISE EXCEPTION 'Invalid status transition from "%" to "%"', v_current_status, p_status USING ERRCODE = '22023';
    END IF;

    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');

    -- Canonical JSON
    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'review_id', p_review_id,
        'reviewer_notes', p_reviewer_notes,
        'status', p_status
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    -- Reservation
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
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Update review status
    UPDATE public.reviews
    SET status = p_status,
        reviewer_notes = COALESCE(p_reviewer_notes, reviewer_notes),
        updated_at = clock_timestamp()
    WHERE id = p_review_id;

    -- Event details
    IF p_status = 'Approved' THEN
        v_event_type := 'approved';
        v_event_action := 'approved submission:';
    ELSIF p_status = 'Changes Requested' THEN
        v_event_type := 'changes_requested';
        v_event_action := 'requested changes on';
    ELSE
        v_event_type := 'resolved';
        v_event_action := 'moved review status to ' || p_status || ' for';
    END IF;

    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        p_review_id,
        v_actor,
        v_event_action,
        v_title,
        v_event_type,
        clock_timestamp(),
        jsonb_build_object('previous_status', v_current_status, 'new_status', p_status)
    );

    v_result := jsonb_build_object(
        'success', true,
        'review_id', p_review_id,
        'status', p_status
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = p_review_id,
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- ============================================================================
-- 3. RPC: toggle_finding_resolved_atomic
-- ============================================================================
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
    v_review_title text;
    v_resolved_now boolean;
    v_new_score integer;
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

    SELECT organisation_id, title INTO v_org_id, v_review_title
    FROM public.reviews
    WHERE id = p_review_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review not found: %', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not an organisation member' USING ERRCODE = '42501';
    END IF;

    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'finding_id', p_finding_id,
        'review_id', p_review_id
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    -- Reservation
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
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Toggle resolved state
    UPDATE public.review_findings
    SET resolved = NOT resolved,
        resolved_at = CASE WHEN NOT resolved THEN clock_timestamp() ELSE NULL END,
        resolved_by = CASE WHEN NOT resolved THEN v_actor ELSE NULL END,
        updated_at = clock_timestamp()
    WHERE id = p_finding_id
      AND review_id = p_review_id
    RETURNING resolved INTO v_resolved_now;

    IF v_resolved_now IS NULL THEN
        RAISE EXCEPTION 'Finding not found: %', p_finding_id USING ERRCODE = 'P0002';
    END IF;

    -- Recompute score
    v_new_score := public.recompute_review_score(p_review_id);

    -- Record activity
    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        p_review_id,
        v_actor,
        CASE WHEN v_resolved_now THEN 'marked finding resolved in' ELSE 'reopened finding in' END,
        v_review_title,
        'resolved',
        clock_timestamp(),
        jsonb_build_object('finding_id', p_finding_id, 'resolved', v_resolved_now, 'compliance_score', v_new_score)
    );

    v_result := jsonb_build_object(
        'success', true,
        'review_id', p_review_id,
        'finding_id', p_finding_id,
        'resolved', v_resolved_now,
        'compliance_score', v_new_score
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = p_finding_id,
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- ============================================================================
-- 4. RPC: apply_finding_correction_atomic
-- ============================================================================
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
    v_review_title text;
    v_current_text text;
    v_finding_title text;
    v_affected_content text;
    v_actor text;
    v_clean_edited text;
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

    SELECT organisation_id, title, text_content
    INTO v_org_id, v_review_title, v_current_text
    FROM public.reviews
    WHERE id = p_review_id
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review not found: %', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not an organisation member' USING ERRCODE = '42501';
    END IF;

    SELECT title, affected_content INTO v_finding_title, v_affected_content
    FROM public.review_findings
    WHERE id = p_finding_id AND review_id = p_review_id
    FOR UPDATE;

    IF v_finding_title IS NULL THEN
        RAISE EXCEPTION 'Finding not found: %', p_finding_id USING ERRCODE = 'P0002';
    END IF;

    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');
    v_clean_edited := replace(trim(p_edited_text), E'\r\n', E'\n');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'apply_to_copy', p_apply_to_copy,
        'edited_text', v_clean_edited,
        'finding_id', p_finding_id,
        'review_id', p_review_id
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    -- Reservation
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
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Update finding correction
    UPDATE public.review_findings
    SET edited_correction = v_clean_edited,
        resolved = CASE WHEN p_apply_to_copy THEN true ELSE resolved END,
        resolved_at = CASE WHEN p_apply_to_copy THEN clock_timestamp() ELSE resolved_at END,
        resolved_by = CASE WHEN p_apply_to_copy THEN v_actor ELSE resolved_by END,
        updated_at = clock_timestamp()
    WHERE id = p_finding_id;

    -- Replace copy if applied
    IF p_apply_to_copy AND length(v_affected_content) > 0 AND length(v_clean_edited) > 0 THEN
        IF position(v_affected_content in v_current_text) > 0 THEN
            UPDATE public.reviews
            SET text_content = replace(text_content, v_affected_content, v_clean_edited),
                updated_at = clock_timestamp()
            WHERE id = p_review_id;
        END IF;
    END IF;

    -- Recompute score
    v_new_score := public.recompute_review_score(p_review_id);

    -- Log activity if applied to copy
    IF p_apply_to_copy THEN
        INSERT INTO public.activity_events (
            id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
        )
        VALUES (
            'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
            v_org_id,
            p_review_id,
            v_actor,
            'applied correction for "' || v_finding_title || '" in',
            v_review_title,
            'correction_applied',
            clock_timestamp(),
            jsonb_build_object('finding_id', p_finding_id, 'applied_to_copy', true, 'compliance_score', v_new_score)
        );
    END IF;

    v_result := jsonb_build_object(
        'success', true,
        'review_id', p_review_id,
        'finding_id', p_finding_id,
        'applied_to_copy', p_apply_to_copy,
        'compliance_score', v_new_score
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = p_finding_id,
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- ============================================================================
-- 5. RPC: update_finding_decision_atomic
-- ============================================================================
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
    v_review_title text;
    v_finding_title text;
    v_actor text;
    v_clean_reason text;
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

    IF p_decision NOT IN ('APPROVE', 'REJECT', 'REQUEST_CHANGES', 'NEEDS_HUMAN_REVIEW') THEN
        RAISE EXCEPTION 'Invalid review decision: %. Must be APPROVE, REJECT, REQUEST_CHANGES, or NEEDS_HUMAN_REVIEW', p_decision USING ERRCODE = '22023';
    END IF;

    v_clean_reason := trim(COALESCE(p_reason, ''));
    IF p_decision = 'REJECT' AND length(v_clean_reason) = 0 THEN
        RAISE EXCEPTION 'A reason is required when rejecting a finding' USING ERRCODE = '22023';
    END IF;

    SELECT organisation_id, title INTO v_org_id, v_review_title
    FROM public.reviews
    WHERE id = p_review_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review not found: %', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not an organisation member' USING ERRCODE = '42501';
    END IF;

    SELECT title INTO v_finding_title
    FROM public.review_findings
    WHERE id = p_finding_id AND review_id = p_review_id;

    IF v_finding_title IS NULL THEN
        RAISE EXCEPTION 'Finding not found: %', p_finding_id USING ERRCODE = 'P0002';
    END IF;

    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'decision', p_decision,
        'finding_id', p_finding_id,
        'reason', v_clean_reason,
        'review_id', p_review_id
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    -- Reservation
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
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Update finding decision
    UPDATE public.review_findings
    SET review_decision = p_decision,
        review_decision_reason = CASE WHEN length(v_clean_reason) > 0 THEN v_clean_reason ELSE NULL END,
        review_decision_at = clock_timestamp(),
        review_decision_by = v_actor,
        updated_at = clock_timestamp()
    WHERE id = p_finding_id;

    -- Log activity
    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        p_review_id,
        v_actor,
        lower(p_decision) || ' finding "' || v_finding_title || '"' || CASE WHEN length(v_clean_reason) > 0 THEN ': ' || v_clean_reason ELSE '' END || ' in',
        v_review_title,
        'finding_decision',
        clock_timestamp(),
        jsonb_build_object('finding_id', p_finding_id, 'decision', p_decision)
    );

    v_result := jsonb_build_object(
        'success', true,
        'review_id', p_review_id,
        'finding_id', p_finding_id,
        'decision', p_decision
    );

    UPDATE public.idempotency_keys
    SET status = 'completed',
        resource_id = p_finding_id,
        response_payload = v_result,
        completed_at = clock_timestamp()
    WHERE organisation_id = v_org_id
      AND user_id = v_caller_id
      AND operation_type = v_op_type
      AND key = p_idempotency_key;

    RETURN v_result;
END;
$$;

-- ============================================================================
-- 6. RPC: add_finding_comment_atomic
-- ============================================================================
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
    v_review_title text;
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

    v_clean_text := replace(trim(p_text), E'\r\n', E'\n');
    IF length(v_clean_text) = 0 THEN
        RAISE EXCEPTION 'Comment text cannot be empty' USING ERRCODE = '22023';
    END IF;

    SELECT organisation_id, title INTO v_org_id, v_review_title
    FROM public.reviews
    WHERE id = p_review_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review not found: %', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not an organisation member' USING ERRCODE = '42501';
    END IF;

    SELECT title INTO v_finding_title
    FROM public.review_findings
    WHERE id = p_finding_id AND review_id = p_review_id;

    IF v_finding_title IS NULL THEN
        RAISE EXCEPTION 'Finding not found: %', p_finding_id USING ERRCODE = 'P0002';
    END IF;

    v_author := COALESCE(trim(p_author_name), 'Reviewer');
    v_role := COALESCE(trim(p_author_role), 'Brand Governance Lead');

    v_canonical_json := jsonb_build_object(
        'author_name', v_author,
        'author_role', v_role,
        'comment_id', p_comment_id,
        'finding_id', p_finding_id,
        'parent_comment_id', p_parent_comment_id,
        'review_id', p_review_id,
        'text', v_clean_text
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    -- Reservation
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
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Insert comment
    INSERT INTO public.review_comments (
        id, review_id, finding_id, author, role, text, parent_comment_id, created_at
    )
    VALUES (
        trim(p_comment_id), p_review_id, p_finding_id, v_author, v_role, v_clean_text, p_parent_comment_id, clock_timestamp()
    );

    -- Log activity
    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        p_review_id,
        v_author,
        'commented on finding "' || v_finding_title || '" in',
        v_review_title,
        'comment_added',
        clock_timestamp(),
        jsonb_build_object('finding_id', p_finding_id, 'comment_id', trim(p_comment_id))
    );

    v_result := jsonb_build_object(
        'success', true,
        'comment_id', trim(p_comment_id),
        'review_id', p_review_id,
        'finding_id', p_finding_id
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

-- ============================================================================
-- 7. RPC: add_manual_finding_atomic
-- ============================================================================
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
    v_review_title text;
    v_clean_title text;
    v_clean_desc text;
    v_clean_rec text;
    v_clean_aff text;
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

    v_clean_title := trim(p_title);
    IF length(v_clean_title) = 0 THEN
        RAISE EXCEPTION 'Finding title cannot be empty' USING ERRCODE = '22023';
    END IF;

    SELECT organisation_id, title INTO v_org_id, v_review_title
    FROM public.reviews
    WHERE id = p_review_id
    FOR UPDATE;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Review not found: %', p_review_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not an organisation member' USING ERRCODE = '42501';
    END IF;

    v_actor := COALESCE(trim(p_actor_name), 'Reviewer');
    v_clean_desc := replace(trim(COALESCE(p_description, '')), E'\r\n', E'\n');
    v_clean_rec := replace(trim(COALESCE(p_recommendation, '')), E'\r\n', E'\n');
    v_clean_aff := replace(trim(COALESCE(p_affected_content, '')), E'\r\n', E'\n');

    v_canonical_json := jsonb_build_object(
        'actor_name', v_actor,
        'affected_content', v_clean_aff,
        'brand_rule_id', CASE WHEN p_brand_rule_id IS NOT NULL THEN lower(p_brand_rule_id::text) ELSE NULL END,
        'category', trim(p_category),
        'description', v_clean_desc,
        'detected_value', trim(COALESCE(p_detected_value, '')),
        'evidence_status', lower(trim(p_evidence_status)),
        'expected_value', trim(COALESCE(p_expected_value, '')),
        'finding_id', trim(p_finding_id),
        'recommendation', v_clean_rec,
        'review_id', p_review_id,
        'severity', lower(trim(p_severity)),
        'source_reference', trim(COALESCE(p_source_reference, '')),
        'title', v_clean_title
    )::text;

    v_payload_hash := encode(digest(v_canonical_json::bytea, 'sha256'), 'hex');

    -- Reservation
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
            WHERE organisation_id = v_org_id
              AND user_id = v_caller_id
              AND operation_type = v_op_type
              AND key = p_idempotency_key;
        ELSE
            RETURN v_existing_response;
        END IF;
    END IF;

    -- Insert manual finding
    INSERT INTO public.review_findings (
        id, review_id, brand_rule_id, rule_id, category, title, description, severity,
        evidence_status, detected_value, expected_value, source_reference, recommendation,
        affected_content, resolved, requires_human_review, created_at, updated_at
    )
    VALUES (
        trim(p_finding_id), p_review_id, p_brand_rule_id, trim(p_rule_id), trim(p_category), v_clean_title, v_clean_desc, lower(trim(p_severity)),
        lower(trim(p_evidence_status)), trim(COALESCE(p_detected_value, '')), trim(COALESCE(p_expected_value, '')),
        trim(COALESCE(p_source_reference, '')), v_clean_rec, v_clean_aff, false, true, clock_timestamp(), clock_timestamp()
    );

    -- Recompute score
    v_new_score := public.recompute_review_score(p_review_id);

    -- Log activity
    INSERT INTO public.activity_events (
        id, organisation_id, review_id, actor, action, target, type, timestamp, metadata
    )
    VALUES (
        'act-' || extract(epoch from clock_timestamp())::bigint || '-' || floor(random() * 1000)::int,
        v_org_id,
        p_review_id,
        v_actor,
        'added manual finding "' || v_clean_title || '" to',
        v_review_title,
        'manual_finding_added',
        clock_timestamp(),
        jsonb_build_object('finding_id', trim(p_finding_id), 'compliance_score', v_new_score)
    );

    v_result := jsonb_build_object(
        'success', true,
        'finding_id', trim(p_finding_id),
        'review_id', p_review_id,
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

-- Revoke execute from public; grant to authenticated
REVOKE ALL ON FUNCTION public.recompute_review_score(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_review_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_review_status_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.toggle_finding_resolved_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_finding_correction_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_finding_decision_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_finding_comment_atomic FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_manual_finding_atomic FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.recompute_review_score(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_review_status_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_finding_resolved_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_finding_correction_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_finding_decision_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_finding_comment_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_manual_finding_atomic TO authenticated;
