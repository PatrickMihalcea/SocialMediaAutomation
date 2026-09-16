-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "release_on_approval" TEXT,
ADD COLUMN     "workflow_node_run_id" UUID;

-- CreateIndex
CREATE INDEX "posts_workflow_node_run_id_idx" ON "posts"("workflow_node_run_id");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_workflow_node_run_id_fkey" FOREIGN KEY ("workflow_node_run_id") REFERENCES "workflow_node_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
