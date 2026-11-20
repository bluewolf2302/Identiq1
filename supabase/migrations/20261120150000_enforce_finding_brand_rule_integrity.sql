BEGIN;

CREATE OR REPLACE FUNCTION public.validate_finding_brand_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
    v_review_brand_id uuid;
    v_rule_brand_id uuid;
BEGIN
    -- Manual findings without a linked brand rule are allowed.
    IF NEW.brand_rule_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT brand_id
    INTO v_review_brand_id
    FROM public.reviews
    WHERE id = NEW.review_id;

    IF v_review_brand_id IS NULL THEN
        RAISE EXCEPTION 'Review not found or has no brand'
            USING ERRCODE = '23503';
    END IF;

    SELECT brand_id
    INTO v_rule_brand_id
    FROM public.brand_rules
    WHERE id = NEW.brand_rule_id;

    IF v_rule_brand_id IS NULL
       OR v_rule_brand_id IS DISTINCT FROM v_review_brand_id THEN
        RAISE EXCEPTION
            'Brand rule does not belong to the review brand'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_finding_brand_rule() FROM PUBLIC;



CREATE TRIGGER enforce_finding_brand_rule
BEFORE INSERT OR UPDATE OF review_id, brand_rule_id
ON public.review_findings
FOR EACH ROW
EXECUTE FUNCTION public.validate_finding_brand_rule();

COMMIT;