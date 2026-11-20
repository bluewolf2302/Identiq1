BEGIN;

-- Prevent authenticated clients from directly modifying review rows.
-- Approved SECURITY DEFINER governance RPCs retain their owner privileges.
REVOKE UPDATE ON TABLE public.reviews FROM authenticated;

COMMIT;