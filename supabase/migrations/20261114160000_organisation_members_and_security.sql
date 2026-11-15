-- Migration: 20261114160000_organisation_members_and_security.sql
-- Description: Create organisation_members, tenancy RLS helpers, trigger protection, and first-owner provisioning.
-- Author: Harsh Joshi (Governance & Persistence)

-- 1. Create organisation_members table
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

-- 2. Helper functions (SECURITY DEFINER with fixed search_path to prevent recursive RLS)
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
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

-- Revoke execute from public; grant to authenticated
REVOKE ALL ON FUNCTION public.is_org_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_org_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_org_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, text) TO authenticated;

-- 3. Trigger to enforce membership rules & prevent privilege escalation
CREATE OR REPLACE FUNCTION public.trg_enforce_organisation_members_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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

-- 4. Enable RLS and define policies
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_members ENABLE ROW LEVEL SECURITY;

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

-- 5. Revocations and table grants
REVOKE ALL ON TABLE public.organisations FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.organisation_members FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.organisations TO authenticated;
GRANT UPDATE (name) ON TABLE public.organisations TO authenticated;
REVOKE INSERT, DELETE ON TABLE public.organisations FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.organisation_members TO authenticated;

-- 6. First-owner provisioning RPC
CREATE OR REPLACE FUNCTION public.create_organisation_and_owner(
    p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
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

    -- Create default brand for the organisation
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

-- RLS policies for brands
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brands TO authenticated;

REVOKE ALL ON FUNCTION public.create_organisation_and_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organisation_and_owner(text) TO authenticated;
