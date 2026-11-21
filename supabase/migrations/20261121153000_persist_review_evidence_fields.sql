BEGIN;

-- Retain the existing atomic review workflow while persisting structured evidence.
CREATE OR REPLACE FUNCTION public.submit_review_atomic_with_evidence(
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
  v_result jsonb;
  v_f jsonb;
  v_reference jsonb;
  v_updated_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_org_member(p_organisation_id) THEN
    RAISE EXCEPTION 'Forbidden: User is not a member of the organisation'
      USING ERRCODE = '42501';
  END IF;

  IF p_findings IS NULL OR jsonb_typeof(p_findings) <> 'array' THEN
    RAISE EXCEPTION 'Review findings must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  FOR v_f IN SELECT value FROM jsonb_array_elements(p_findings)
  LOOP
    IF v_f ? 'evidenceReferences' THEN
      IF jsonb_typeof(v_f->'evidenceReferences') <> 'array' THEN
        RAISE EXCEPTION 'Evidence references must be a JSON array'
          USING ERRCODE = '22023';
      END IF;

      FOR v_reference IN
        SELECT value FROM jsonb_array_elements(v_f->'evidenceReferences')
      LOOP
        IF jsonb_typeof(v_reference) <> 'object'
           OR nullif(btrim(v_reference->>'sourceId'), '') IS NULL
           OR nullif(btrim(v_reference->>'sourceType'), '') IS NULL
           OR nullif(btrim(v_reference->>'sourceTitle'), '') IS NULL
           OR (
             v_reference ? 'versionId'
             AND (
               jsonb_typeof(v_reference->'versionId') <> 'string'
               OR nullif(btrim(v_reference->>'versionId'), '') IS NULL
             )
           ) THEN
          RAISE EXCEPTION 'Evidence reference is incomplete or invalid'
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    IF v_f ? 'sourceVersionIds' THEN
      IF jsonb_typeof(v_f->'sourceVersionIds') <> 'array' THEN
        RAISE EXCEPTION 'Source version IDs must be a JSON array'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_f->'sourceVersionIds') AS version(value)
        WHERE jsonb_typeof(version.value) <> 'string'
          OR nullif(btrim(version.value #>> '{}'), '') IS NULL
      ) THEN
        RAISE EXCEPTION 'Source version IDs must be non-empty strings'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  v_result := public.submit_review_atomic(
    p_idempotency_key,
    p_review_id,
    p_organisation_id,
    p_brand_id,
    p_title,
    p_content_type,
    p_guideline_collection,
    p_text_content,
    p_compliance_score,
    p_pastel_theme,
    p_submitted_by,
    p_asset_url,
    p_asset_name,
    p_reviewer_notes,
    p_provider_used,
    p_fallback_used,
    p_analysis_status,
    p_analysis_run_id,
    p_visual_summary,
    p_ocr_blocks,
    p_findings
  );

  FOR v_f IN SELECT value FROM jsonb_array_elements(p_findings)
  LOOP
    IF v_f ? 'evidenceReferences' OR v_f ? 'sourceVersionIds' THEN
      UPDATE public.review_findings AS finding
      SET
        evidence_references = CASE
          WHEN v_f ? 'evidenceReferences'
            THEN v_f->'evidenceReferences'
          ELSE finding.evidence_references
        END,
        source_version_ids = CASE
          WHEN v_f ? 'sourceVersionIds'
            THEN ARRAY(
              SELECT jsonb_array_elements_text(v_f->'sourceVersionIds')
            )
          ELSE finding.source_version_ids
        END
      WHERE finding.id = v_f->>'id'
        AND finding.review_id = trim(p_review_id)
        AND EXISTS (
          SELECT 1
          FROM public.reviews AS review
          WHERE review.id = finding.review_id
            AND review.organisation_id = p_organisation_id
            AND review.brand_id = p_brand_id
        );

      GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
      IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION 'Could not persist review evidence for finding %', v_f->>'id'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review_atomic_with_evidence(
  text, text, uuid, uuid, text, text, text, text, integer, text, text,
  text, text, text, text, boolean, text, text, jsonb, jsonb, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.submit_review_atomic_with_evidence(
  text, text, uuid, uuid, text, text, text, text, integer, text, text,
  text, text, text, text, boolean, text, text, jsonb, jsonb, jsonb
) TO authenticated;

COMMIT;
