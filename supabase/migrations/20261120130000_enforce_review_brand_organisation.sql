BEGIN;

-- Required target key for the composite foreign key.
ALTER TABLE public.brands
ADD CONSTRAINT brands_id_organisation_id_key
UNIQUE (id, organisation_id);

-- A review's brand must belong to the same organisation.
ALTER TABLE public.reviews
ADD CONSTRAINT reviews_brand_organisation_fkey
FOREIGN KEY (brand_id, organisation_id)
REFERENCES public.brands (id, organisation_id)
ON DELETE CASCADE;

COMMIT;