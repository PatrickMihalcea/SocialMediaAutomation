'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma, WorkflowRunTrigger } from '@prisma/client';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { conflict, invalid, notFound } from '@/lib/errors';
import { getDefinition, isNodeType, parseConfig } from '@/lib/workflows/definitions';
import { checkCompatible } from '@/lib/workflows/ports';
import { reaches } from '@/lib/workflows/graph';
import {
  cancelWorkflowRun,
  retryWorkflowNode,
  startWorkflowRun,
} from '@/lib/workflows/engine';
import { computeNextRun } from '@/lib/workflows/schedule';

function refresh(slug: string, workflowId?: string) {
  revalidatePath(`/w/${slug}/workflows`);
  if (workflowId) revalidatePath(`/w/${slug}/workflows/${workflowId}`);
}

// ---------------------------------------------------------------- workflow

export async function createWorkflowAction(slug: string, input: { name: string; description?: string }) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const name = input.name.trim();
  if (name.length < 2) throw invalid('Give the workflow a name.');

  const workflow = await db.workflow.create({
    data: {
      workspaceId: ctx.workspace.id,
      createdById: ctx.user.id,
      name,
      description: input.description?.trim() || null,
      timezone: ctx.workspace.timezone,
    },
    select: { id: true, name: true },
  });

  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: 'workflow.created',
    entityType: 'workflow',
    entityId: workflow.id,
    metadata: { name },
  });
  refresh(slug);
  return workflow;
}

const scheduleSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  enabled: z.boolean().optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  scheduleMinute: z.number().int().min(0).max(59).optional(),
  timezone: z.string().min(1).max(100).optional(),
});

export async function updateWorkflowAction(
  slug: string,
  workflowId: string,
  input: z.infer<typeof scheduleSchema>,
) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const parsed = scheduleSchema.parse(input);

  const existing = await db.workflow.findFirst({
    where: { id: workflowId, workspaceId: ctx.workspace.id },
  });
  if (!existing) throw notFound('That workflow no longer exists.');

  const merged = { ...existing, ...parsed };
  const updated = await db.workflow.update({
    where: { id: workflowId },
    data: {
      ...parsed,
      // Recomputed on every save so a schedule change takes effect at the next
      // tick rather than at the slot the old settings had already booked.
      nextRunAt: computeNextRun(merged),
    },
    select: { id: true, name: true, nextRunAt: true },
  });

  refresh(slug, workflowId);
  return updated;
}

export async function deleteWorkflowAction(slug: string, workflowId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const deleted = await db.workflow.deleteMany({
    where: { id: workflowId, workspaceId: ctx.workspace.id },
  });
  if (!deleted.count) throw notFound('That workflow no longer exists.');

  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: 'workflow.deleted',
    entityType: 'workflow',
    entityId: workflowId,
  });
  refresh(slug);
}

// ---------------------------------------------------------------- nodes

export async function addNodeAction(
  slug: string,
  workflowId: string,
  input: { type: string; positionX: number; positionY: number },
) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  if (!isNodeType(input.type)) throw invalid('That step type is not available.');
  const definition = getDefinition(input.type)!;

  const workflow = await db.workflow.findFirst({
    where: { id: workflowId, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!workflow) throw notFound('That workflow no longer exists.');

  const node = await db.workflowNode.create({
    data: {
      workflowId,
      workspaceId: ctx.workspace.id,
      type: input.type,
      name: definition.label,
      // Defaults come from the node's own schema, so a new node is immediately
      // valid rather than half-configured.
      config: definition.configSchema.parse({}) as Prisma.InputJsonValue,
      positionX: input.positionX,
      positionY: input.positionY,
    },
  });

  refresh(slug, workflowId);
  return node;
}

export async function updateNodeAction(
  slug: string,
  nodeId: string,
  input: { name?: string; config?: unknown },
) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const node = await db.workflowNode.findFirst({
    where: { id: nodeId, workspaceId: ctx.workspace.id },
  });
  if (!node) throw notFound('That step no longer exists.');

  let config = node.config;
  if (input.config !== undefined) {
    try {
      config = parseConfig(node.type, input.config) as Prisma.JsonValue;
    } catch (error) {
      if (error instanceof z.ZodError) throw error;
      throw invalid('Those settings are not valid for this step.');
    }
  }

  const updated = await db.workflowNode.update({
    where: { id: nodeId },
    data: {
      name: input.name?.trim() || node.name,
      config: config as Prisma.InputJsonValue,
      // A settings change is a new version; a drag is not.
      version: input.config !== undefined ? { increment: 1 } : undefined,
    },
  });

  refresh(slug, node.workflowId);
  return updated;
}

/**
 * Positions are saved on drag-end in one batch, never per frame — a server
 * action per pointer move would be hundreds of writes to drag one box.
 */
export async function saveNodePositionsAction(
  slug: string,
  workflowId: string,
  positions: { id: string; x: number; y: number }[],
) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  if (positions.length === 0) return;

  await db.$transaction(
    positions.map((position) =>
      db.workflowNode.updateMany({
        where: { id: position.id, workflowId, workspaceId: ctx.workspace.id },
        // Note: no version bump. Moving a node is not a configuration change.
        data: { positionX: position.x, positionY: position.y },
      }),
    ),
  );
}

export async function deleteNodeAction(slug: string, nodeId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const node = await db.workflowNode.findFirst({
    where: { id: nodeId, workspaceId: ctx.workspace.id },
    select: { id: true, workflowId: true },
  });
  if (!node) throw notFound('That step no longer exists.');

  // Edges cascade, so removing a node cannot leave a dangling connection.
  await db.workflowNode.delete({ where: { id: nodeId } });
  refresh(slug, node.workflowId);
}

// ---------------------------------------------------------------- edges

export async function connectNodesAction(
  slug: string,
  workflowId: string,
  input: { sourceNodeId: string; sourcePort: string; targetNodeId: string; targetPort: string },
) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  if (input.sourceNodeId === input.targetNodeId) {
    throw invalid('A step cannot connect to itself.');
  }

  // Serializable because two people each adding an individually-valid edge can
  // together close a loop; only serialising the read-then-write catches that.
  return db.$transaction(
    async (tx) => {
      const nodes = await tx.workflowNode.findMany({
        where: { workflowId, workspaceId: ctx.workspace.id },
      });
      const source = nodes.find((n) => n.id === input.sourceNodeId);
      const target = nodes.find((n) => n.id === input.targetNodeId);
      if (!source || !target) throw notFound('One of those steps no longer exists.');

      const outPort = getDefinition(source.type)?.outputs.find((p) => p.id === input.sourcePort);
      const inPort = getDefinition(target.type)?.inputs.find((p) => p.id === input.targetPort);
      if (!outPort || !inPort) throw invalid('That connection point no longer exists.');

      const incompatible = checkCompatible(outPort.type, inPort.type);
      if (incompatible) throw invalid(incompatible.reason);

      const edges = await tx.workflowEdge.findMany({
        where: { workflowId, workspaceId: ctx.workspace.id },
      });
      if (reaches(edges, input.targetNodeId, input.sourceNodeId)) {
        throw invalid('That connection would create a loop. Workflows must flow one way.');
      }

      const occupied = edges.find(
        (e) => e.targetNodeId === input.targetNodeId && e.targetPort === input.targetPort,
      );
      if (occupied) {
        throw conflict(`"${target.name}" already has something connected to its ${inPort.label} input.`);
      }

      const edge = await tx.workflowEdge.create({
        data: { workflowId, workspaceId: ctx.workspace.id, ...input },
      });
      refresh(slug, workflowId);
      return edge;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function disconnectAction(slug: string, edgeId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const edge = await db.workflowEdge.findFirst({
    where: { id: edgeId, workspaceId: ctx.workspace.id },
    select: { id: true, workflowId: true },
  });
  if (!edge) throw notFound('That connection no longer exists.');
  await db.workflowEdge.delete({ where: { id: edgeId } });
  refresh(slug, edge.workflowId);
}

// ---------------------------------------------------------------- runs

export async function runWorkflowAction(slug: string, workflowId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:run');
  const runId = await startWorkflowRun({
    workflowId,
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    trigger: WorkflowRunTrigger.MANUAL,
  });
  refresh(slug, workflowId);
  return { runId };
}

export async function cancelRunAction(slug: string, runId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:run');
  await cancelWorkflowRun(runId, ctx.workspace.id);
  revalidatePath(`/w/${slug}/workflows`);
}

export async function retryNodeAction(slug: string, nodeRunId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:run');
  await retryWorkflowNode(nodeRunId, ctx.workspace.id);
  revalidatePath(`/w/${slug}/workflows`);
}
