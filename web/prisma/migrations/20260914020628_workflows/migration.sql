-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowNodeRunStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowRunTrigger" AS ENUM ('MANUAL', 'SCHEDULE', 'API');

-- AlterEnum
ALTER TYPE "QueueName" ADD VALUE 'WORKFLOW';

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "audio_analyzed_at" TIMESTAMP(3),
ADD COLUMN     "beat_grid" JSONB,
ADD COLUMN     "bpm" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "created_by_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "viewport" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "schedule_hour" INTEGER NOT NULL DEFAULT 9,
    "schedule_minute" INTEGER NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_nodes" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "position_x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position_y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_edges" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_node_id" UUID NOT NULL,
    "source_port" TEXT NOT NULL,
    "target_node_id" UUID NOT NULL,
    "target_port" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "triggered_by_id" UUID,
    "trigger" "WorkflowRunTrigger" NOT NULL DEFAULT 'MANUAL',
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'QUEUED',
    "graph" JSONB NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_node_runs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "node_type" TEXT NOT NULL,
    "node_name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" "WorkflowNodeRunStatus" NOT NULL DEFAULT 'PENDING',
    "pending_deps" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "job_id" UUID,
    "queued_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "heartbeat_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_node_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_node_run_assets" (
    "node_run_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "port" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_node_run_assets_pkey" PRIMARY KEY ("node_run_id","port","media_asset_id")
);

-- CreateIndex
CREATE INDEX "workflows_workspace_id_idx" ON "workflows"("workspace_id");

-- CreateIndex
CREATE INDEX "workflows_workspace_id_archived_at_idx" ON "workflows"("workspace_id", "archived_at");

-- CreateIndex
CREATE INDEX "workflows_next_run_at_idx" ON "workflows"("next_run_at");

-- CreateIndex
CREATE INDEX "workflows_created_at_idx" ON "workflows"("created_at");

-- CreateIndex
CREATE INDEX "workflow_nodes_workflow_id_idx" ON "workflow_nodes"("workflow_id");

-- CreateIndex
CREATE INDEX "workflow_nodes_workspace_id_idx" ON "workflow_nodes"("workspace_id");

-- CreateIndex
CREATE INDEX "workflow_nodes_created_at_idx" ON "workflow_nodes"("created_at");

-- CreateIndex
CREATE INDEX "workflow_edges_workflow_id_idx" ON "workflow_edges"("workflow_id");

-- CreateIndex
CREATE INDEX "workflow_edges_workspace_id_idx" ON "workflow_edges"("workspace_id");

-- CreateIndex
CREATE INDEX "workflow_edges_source_node_id_idx" ON "workflow_edges"("source_node_id");

-- CreateIndex
CREATE INDEX "workflow_edges_target_node_id_idx" ON "workflow_edges"("target_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_edges_target_node_id_target_port_key" ON "workflow_edges"("target_node_id", "target_port");

-- CreateIndex
CREATE INDEX "workflow_runs_workspace_id_idx" ON "workflow_runs"("workspace_id");

-- CreateIndex
CREATE INDEX "workflow_runs_workspace_id_status_idx" ON "workflow_runs"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_workflow_id_created_at_idx" ON "workflow_runs"("workflow_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs"("status");

-- CreateIndex
CREATE INDEX "workflow_runs_created_at_idx" ON "workflow_runs"("created_at");

-- CreateIndex
CREATE INDEX "workflow_node_runs_workspace_id_idx" ON "workflow_node_runs"("workspace_id");

-- CreateIndex
CREATE INDEX "workflow_node_runs_run_id_status_idx" ON "workflow_node_runs"("run_id", "status");

-- CreateIndex
CREATE INDEX "workflow_node_runs_node_id_idx" ON "workflow_node_runs"("node_id");

-- CreateIndex
CREATE INDEX "workflow_node_runs_status_heartbeat_at_idx" ON "workflow_node_runs"("status", "heartbeat_at");

-- CreateIndex
CREATE INDEX "workflow_node_runs_created_at_idx" ON "workflow_node_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_node_runs_run_id_node_id_key" ON "workflow_node_runs"("run_id", "node_id");

-- CreateIndex
CREATE INDEX "workflow_node_run_assets_media_asset_id_idx" ON "workflow_node_run_assets"("media_asset_id");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_runs" ADD CONSTRAINT "workflow_node_runs_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_run_assets" ADD CONSTRAINT "workflow_node_run_assets_node_run_id_fkey" FOREIGN KEY ("node_run_id") REFERENCES "workflow_node_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_node_run_assets" ADD CONSTRAINT "workflow_node_run_assets_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
