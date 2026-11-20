BEGIN;

ALTER TABLE public.review_comments
ADD CONSTRAINT review_comments_id_review_finding_unique
UNIQUE (id, review_id, finding_id);

ALTER TABLE public.review_comments
ADD CONSTRAINT review_comments_parent_thread_fkey
FOREIGN KEY (parent_comment_id, review_id, finding_id)
REFERENCES public.review_comments (id, review_id, finding_id)
ON DELETE CASCADE;

COMMIT;