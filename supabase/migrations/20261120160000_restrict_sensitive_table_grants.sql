BEGIN;

REVOKE ALL PRIVILEGES ON TABLE
    public.assets,
    public.audit_logs,
    public.brand_facts,
    public.brand_rules
FROM anon, authenticated;

COMMIT;