CREATE TABLE "public"."assets" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "brand_id"           uuid,
  "file_name"          text,
  "file_path"          text,
  "file_type"          text,
  "asset_category"     text,
  "approved"           boolean                  NOT NULL DEFAULT false,
  "source_document_id" text,
  "source_title"       text,
  "version_id"         text,
  "page_number"        integer,
  "section"            text,
  "applicable_to"      jsonb,
  CONSTRAINT "assets_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."assets"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."audit_logs" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "brand_id"    uuid,
  "action"      text,
  "entity_type" text,
  "entity_id"   uuid,
  "details"     jsonb,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_logs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."brand_facts" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "brand_id"            uuid,
  "fact_name"           text,
  "fact_value"          text,
  "category"            text,
  "source"              text,
  "approved"            boolean                  NOT NULL DEFAULT false,
  "source_document_id"  text,
  "source_title"        text,
  "version_id"          text,
  "page_number"         integer,
  "section"             text,
  "applicable_to"       jsonb,
  "supporting_evidence" text,
  "restrictions"        jsonb                    NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "brand_facts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."brand_facts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."brand_rules" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "brand_id"           uuid                     NOT NULL,
  "rule_name"          text                     NOT NULL,
  "category"           text                     NOT NULL,
  "description"        text,
  "severity"           text,
  "approved"           boolean                  NOT NULL DEFAULT false,
  "source_document_id" text,
  "source_title"       text,
  "version_id"         text,
  "page_number"        integer,
  "section"            text,
  "applicable_to"      jsonb,
  CONSTRAINT "brand_rules_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."brand_rules"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."brands" (
  "id"                         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "name"                       text                     NOT NULL,
  "description"                text,
  "website"                    text,
  "organisation_id"            uuid                     NOT NULL,
  "approved"                   boolean                  NOT NULL DEFAULT false,
  "source_document_id"         text,
  "source_title"               text,
  "version_id"                 text,
  "page_number"                integer,
  "section"                    text,
  "applicable_to"              jsonb,
  "profile"                    text,
  "voice_and_tone"             text,
  "communication_instructions" text[]                   NOT NULL DEFAULT '{}'::text[],
  "design_guidelines"          text[]                   NOT NULL DEFAULT '{}'::text[],
  "usage_policies"             text[]                   NOT NULL DEFAULT '{}'::text[],
  "approved_colours"           text[]                   NOT NULL DEFAULT '{}'::text[],
  "typography_references"      text[]                   NOT NULL DEFAULT '{}'::text[],
  "approved_logo_references"   text[]                   NOT NULL DEFAULT '{}'::text[],
  "asset_metadata"             text[]                   NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT "brands_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."brands"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."organisations" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "organisations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."assets"
  ADD CONSTRAINT "assets_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES public.brands(id);

ALTER TABLE "public"."audit_logs"
  ADD CONSTRAINT "audit_logs_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES public.brands(id);

ALTER TABLE "public"."brand_facts"
  ADD CONSTRAINT "brand_facts_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES public.brands(id);

ALTER TABLE "public"."brand_rules"
  ADD CONSTRAINT "brand_rules_brand_id_fkey" FOREIGN KEY (brand_id) REFERENCES public.brands(id);

ALTER TABLE "public"."brands"
  ADD CONSTRAINT "brands_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES public.organisations(id);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assets" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."assets" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assets" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."assets" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_logs" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."audit_logs" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_logs" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_logs" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brand_facts" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."brand_facts" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brand_facts" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brand_facts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brand_rules" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."brand_rules" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brand_rules" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brand_rules" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brands" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."brands" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brands" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brands" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."organisations" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."organisations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."organisations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."organisations" TO "service_role";

