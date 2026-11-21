
BEGIN;

-- 1. Enforce the brand/organisation relationship for guideline records.


-- 2. Persist complete guideline documents and their versions.
CREATE TABLE public.guideline_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL
    REFERENCES public.organisations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL,
  document_id text NOT NULL,
  version_id text NOT NULL,
  title text NOT NULL,
  record jsonb NOT NULL,
  storage_path text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guideline_documents_brand_org_fkey
    FOREIGN KEY (brand_id, organisation_id)
    REFERENCES public.brands(id, organisation_id)
    ON DELETE CASCADE,

  CONSTRAINT guideline_documents_brand_document_version_key
    UNIQUE (brand_id, document_id, version_id),

  CONSTRAINT guideline_documents_document_id_check
    CHECK (document_id = record->>'documentId'),

  CONSTRAINT guideline_documents_version_id_check
    CHECK (version_id = record->>'versionId'),

  CONSTRAINT guideline_documents_title_check
    CHECK (title = record->>'title'),

  CONSTRAINT guideline_documents_record_object_check
    CHECK (jsonb_typeof(record) = 'object')
);

CREATE INDEX guideline_documents_org_brand_idx
  ON public.guideline_documents (organisation_id, brand_id);

ALTER TABLE public.guideline_documents ENABLE ROW LEVEL SECURITY;

-- 3. Guideline document policies.
CREATE POLICY guideline_documents_select_policy
  ON public.guideline_documents
  FOR SELECT TO authenticated
  USING (public.is_org_member(organisation_id));

CREATE POLICY guideline_documents_insert_policy
  ON public.guideline_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_org_role(organisation_id, 'contributor')
    AND created_by = auth.uid()
    AND updated_by = auth.uid()
  );

CREATE POLICY guideline_documents_update_policy
  ON public.guideline_documents
  FOR UPDATE TO authenticated
  USING (public.has_org_role(organisation_id, 'contributor'))
  WITH CHECK (
    public.has_org_role(organisation_id, 'contributor')
    AND updated_by = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE
  ON public.guideline_documents TO authenticated;

REVOKE ALL
  ON public.guideline_documents FROM anon;

-- 4. Allow authenticated users to read and maintain asset metadata
-- only when they belong to the organisation owning the asset's brand.
CREATE POLICY assets_select_org_policy
  ON public.assets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = assets.brand_id
        AND public.is_org_member(b.organisation_id)
    )
  );

CREATE POLICY assets_insert_org_policy
  ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = assets.brand_id
        AND public.has_org_role(b.organisation_id, 'contributor')
    )
  );

CREATE POLICY assets_update_org_policy
  ON public.assets
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = assets.brand_id
        AND public.has_org_role(b.organisation_id, 'contributor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = assets.brand_id
        AND public.has_org_role(b.organisation_id, 'contributor')
    )
  );

GRANT SELECT, INSERT, UPDATE
  ON public.assets TO authenticated;

REVOKE ALL
  ON public.assets FROM anon;

-- 5. Private Storage policies.
-- Required object path format: <brand-uuid>/<document-id>/<filename>
CREATE POLICY brand_documents_select_org_policy
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'brand-documents'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = (storage.foldername(name))[1]
        AND public.is_org_member(b.organisation_id)
    )
  );

CREATE POLICY brand_documents_insert_org_policy
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-documents'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = (storage.foldername(name))[1]
        AND public.has_org_role(b.organisation_id, 'contributor')
    )
  );

CREATE POLICY brand_documents_update_org_policy
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-documents'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = (storage.foldername(name))[1]
        AND public.has_org_role(b.organisation_id, 'contributor')
    )
  )
  WITH CHECK (
    bucket_id = 'brand-documents'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = (storage.foldername(name))[1]
        AND public.has_org_role(b.organisation_id, 'contributor')
    )
  );

CREATE POLICY brand_documents_delete_org_policy
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'brand-documents'
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id::text = (storage.foldername(name))[1]
        AND public.has_org_role(b.organisation_id, 'admin')
    )
  );

COMMIT;
