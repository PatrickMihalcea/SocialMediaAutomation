-- Recovers the origin of posts created before posts.workflow_node_run_id existed.
--
-- Not invented: every draft and publish step already recorded the post id it
-- created in its own output JSON, so the link is a fact the database was
-- already holding in a shape nothing could query. This copies it into the
-- column, which is what makes "where did this post come from" answerable for
-- runs that happened before the column was added.
--
-- Only fills rows that are still null, so it is safe to re-run and can never
-- overwrite a link the application wrote.
UPDATE posts AS p
SET workflow_node_run_id = r.id
FROM workflow_node_runs AS r
WHERE p.workflow_node_run_id IS NULL
  AND r.workspace_id = p.workspace_id
  AND r.output -> 'post' ->> 'id' = p.id::text;
