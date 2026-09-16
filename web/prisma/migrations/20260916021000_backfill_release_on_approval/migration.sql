-- Recovers what approving an already-pending post is supposed to do.
--
-- A publish step that paused for review kept its release mode in its own
-- config JSON and then dropped it, because nothing carried it across the
-- pause. The config row is still there, so the intent is recoverable rather
-- than lost, and the approval screen can state the real consequence instead of
-- falling back to "this will not publish it".
--
-- Restricted to posts still awaiting approval: a post already approved,
-- scheduled or published has had its outcome decided by a person, and
-- backfilling an intent onto it would risk that intent being acted on later.
UPDATE posts AS p
SET release_on_approval = r.config ->> 'mode'
FROM workflow_node_runs AS r
WHERE p.workflow_node_run_id = r.id
  AND p.release_on_approval IS NULL
  AND p.status = 'PENDING_APPROVAL'
  AND r.node_type = 'PUBLISH'
  AND r.config ->> 'requireApproval' = 'true'
  AND r.config ->> 'mode' IN ('now', 'queue');
