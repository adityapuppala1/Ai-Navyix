-- Correct SQL NULL acceptance in the original JSON shape constraints.
-- Do not edit an applied migration. This migration validates existing rows, never repairs/deletes them.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE public."WorkflowState" ADD CONSTRAINT workflow_shape_strict CHECK ((
  revision > 0 AND jsonb_typeof(data) = 'object'
  AND jsonb_typeof(data->'id') = 'string' AND data->>'id' = "projectId"::text
  AND jsonb_typeof(data->'revision') = 'number' AND data->'revision' = to_jsonb(revision)
  AND octet_length(data::text) <= 3500000
) IS TRUE) NOT VALID;
ALTER TABLE public."WorkflowSnapshot" ADD CONSTRAINT snapshot_shape_strict CHECK ((
  jsonb_typeof(data) = 'object'
  AND jsonb_typeof(data->'id') = 'string' AND data->>'id' = id
  AND jsonb_typeof(data->'projectId') = 'string' AND data->>'projectId' = "projectId"::text
  AND data->'advisory' = 'true'::jsonb
) IS TRUE) NOT VALID;
ALTER TABLE public."WorkflowState" VALIDATE CONSTRAINT workflow_shape_strict;
ALTER TABLE public."WorkflowSnapshot" VALIDATE CONSTRAINT snapshot_shape_strict;
ALTER TABLE public."WorkflowState" DROP CONSTRAINT workflow_shape;
ALTER TABLE public."WorkflowState" RENAME CONSTRAINT workflow_shape_strict TO workflow_shape;
ALTER TABLE public."WorkflowSnapshot" DROP CONSTRAINT snapshot_shape;
ALTER TABLE public."WorkflowSnapshot" RENAME CONSTRAINT snapshot_shape_strict TO snapshot_shape;
COMMIT;
