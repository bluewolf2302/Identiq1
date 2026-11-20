
BEGIN;

-- Prevent clients from directly invoking the SECURITY DEFINER helper.
-- Existing SECURITY DEFINER governance RPCs can still call it internally.
REVOKE EXECUTE ON FUNCTION public.recompute_review_score(text)
FROM PUBLIC, anon, authenticated;

COMMIT;
