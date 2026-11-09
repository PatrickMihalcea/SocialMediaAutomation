-- Deleting a step from a workflow no longer deletes its history from runs.
ALTER TABLE "workflow_node_runs" DROP CONSTRAINT "workflow_node_runs_node_id_fkey";
