ALTER TABLE public.reviews
    ADD COLUMN IF NOT EXISTS coverage jsonb,
    ADD COLUMN IF NOT EXISTS previous_analysis_run_id text,
    ADD COLUMN IF NOT EXISTS analysis_comparison jsonb;

ALTER TABLE public.review_findings
    ADD COLUMN IF NOT EXISTS explanation text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.analysis_comparisons (
    id text PRIMARY KEY,
    review_id text NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
    organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    previous_run_id text NOT NULL,
    current_run_id text NOT NULL,
    comparison jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_analysis_comparisons_review
    ON public.analysis_comparisons(review_id, created_at DESC);

ALTER TABLE public.analysis_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS analysis_comparisons_select_policy ON public.analysis_comparisons;
CREATE POLICY analysis_comparisons_select_policy ON public.analysis_comparisons
    FOR SELECT TO authenticated
    USING (public.is_org_member(organisation_id));

DROP POLICY IF EXISTS analysis_comparisons_insert_policy ON public.analysis_comparisons;
CREATE POLICY analysis_comparisons_insert_policy ON public.analysis_comparisons
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_org_member(organisation_id)
        AND EXISTS (
            SELECT 1 FROM public.reviews r
            WHERE r.id = analysis_comparisons.review_id
              AND r.organisation_id = analysis_comparisons.organisation_id
              AND r.analysis_run_id = analysis_comparisons.current_run_id
              AND r.previous_analysis_run_id = analysis_comparisons.previous_run_id
              AND analysis_comparisons.comparison->>'currentRunId' = analysis_comparisons.current_run_id
              AND analysis_comparisons.comparison->>'previousRunId' = analysis_comparisons.previous_run_id
              AND EXISTS (
                  SELECT 1 FROM public.reviews previous_review
                  WHERE previous_review.organisation_id = analysis_comparisons.organisation_id
                    AND previous_review.analysis_run_id = analysis_comparisons.previous_run_id
              )
        )
    );

CREATE OR REPLACE FUNCTION public.submit_review_with_lineage_atomic(
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
    p_findings jsonb DEFAULT '[]'::jsonb,
    p_previous_analysis_run_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
    v_caller_id uuid;
    v_response jsonb;
BEGIN
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Authentication required' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_org_member(p_organisation_id) THEN
        RAISE EXCEPTION 'Forbidden: User is not a member of organisation %', p_organisation_id
            USING ERRCODE = '42501';
    END IF;

    IF p_previous_analysis_run_id IS NOT NULL THEN
        IF NULLIF(trim(p_analysis_run_id), '') IS NULL
           OR trim(p_analysis_run_id) = trim(p_previous_analysis_run_id) THEN
            RAISE EXCEPTION 'Previous and current analysis runs must be distinct'
                USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.reviews previous_review
            WHERE previous_review.organisation_id = p_organisation_id
              AND previous_review.analysis_run_id = p_previous_analysis_run_id
        ) THEN
            RAISE EXCEPTION 'Previous analysis run is not owned by the organisation'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    v_response := public.submit_review_atomic(
        p_idempotency_key => p_idempotency_key,
        p_review_id => p_review_id,
        p_organisation_id => p_organisation_id,
        p_brand_id => p_brand_id,
        p_title => p_title,
        p_content_type => p_content_type,
        p_guideline_collection => p_guideline_collection,
        p_text_content => p_text_content,
        p_compliance_score => p_compliance_score,
        p_pastel_theme => p_pastel_theme,
        p_submitted_by => p_submitted_by,
        p_asset_url => p_asset_url,
        p_asset_name => p_asset_name,
        p_reviewer_notes => p_reviewer_notes,
        p_provider_used => p_provider_used,
        p_fallback_used => p_fallback_used,
        p_analysis_status => p_analysis_status,
        p_analysis_run_id => p_analysis_run_id,
        p_visual_summary => p_visual_summary,
        p_ocr_blocks => p_ocr_blocks,
        p_findings => p_findings
    );

    IF p_previous_analysis_run_id IS NOT NULL THEN
        UPDATE public.reviews
        SET previous_analysis_run_id = p_previous_analysis_run_id
        WHERE id = trim(p_review_id)
          AND organisation_id = p_organisation_id
          AND analysis_run_id = p_analysis_run_id
          AND (
              previous_analysis_run_id IS NULL
              OR previous_analysis_run_id = p_previous_analysis_run_id
          );
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Review analysis lineage does not match the submitted run'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_review_with_lineage_atomic(
    text, text, uuid, uuid, text, text, text, text, integer, text, text,
    text, text, text, text, boolean, text, text, jsonb, jsonb, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_review_with_lineage_atomic(
    text, text, uuid, uuid, text, text, text, text, integer, text, text,
    text, text, text, text, boolean, text, text, jsonb, jsonb, jsonb, text
) TO authenticated;

GRANT SELECT, INSERT ON TABLE public.analysis_comparisons TO authenticated;
REVOKE ALL ON TABLE public.analysis_comparisons FROM PUBLIC, anon;
