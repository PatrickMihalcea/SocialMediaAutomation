'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma, WorkflowRunTrigger } from '@prisma/client';
import { requireWorkspace } from '@/lib/auth/guard';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { conflict, invalid, notFound } from '@/lib/errors';
import {
  getDefinition,
  getNodePorts,
  isCreatableNodeType,
  nodeSaveConfigIssue,
  parseConfig,
  zodValidationMessage,
} from '@/lib/workflows/definitions';
import { checkAddedEdge } from '@/lib/workflows/port-resolution';
import { reaches } from '@/lib/workflows/graph';
import {
  cancelWorkflowRun,
  retryWorkflowNode,
  startWorkflowRun,
} from '@/lib/workflows/engine';
import { computeNextRun } from '@/lib/workflows/schedule';
import { selectItems } from '@/lib/workflows/select-items';
import { storage } from '@/lib/storage';

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
  // No timezone: it belongs to the workspace, and a workflow that could pick
  // its own would run at a wall-clock time the rest of the workspace disagrees
  // with. Workspace settings is the one place it changes.
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

  const merged = { ...existing, ...parsed, timezone: ctx.workspace.timezone };
  const updated = await db.workflow.update({
    where: { id: workflowId },
    data: {
      ...parsed,
      // Re-asserted so a row stored before the workspace moved zones is brought
      // back in line by the next save.
      timezone: ctx.workspace.timezone,
      // Recomputed on every save so a schedule change takes effect at the next
      // tick rather than at the slot the old settings had already booked.
      nextRunAt: merged.enabled && !merged.archivedAt ? computeNextRun(merged) : null,
    },
    select: { id: true, name: true, nextRunAt: true },
  });

  refresh(slug, workflowId);
  return updated;
}

export async function deleteWorkflowAction(slug: string, workflowId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const workflow = await db.workflow.findFirst({
    where: { id: workflowId, workspaceId: ctx.workspace.id },
    select: { id: true, archivedAt: true },
  });
  if (!workflow) throw notFound('That workflow no longer exists.');
  if (!workflow.archivedAt) throw invalid('Archive this workflow before deleting it permanently.');

  const activeRuns = await db.workflowRun.count({
    where: { workflowId, workspaceId: ctx.workspace.id, status: { in: ['QUEUED', 'RUNNING'] } },
  });
  if (activeRuns) throw conflict('Wait for the active run to finish before deleting this workflow.');

  await db.workflow.delete({ where: { id: workflowId } });

  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: 'workflow.deleted',
    entityType: 'workflow',
    entityId: workflowId,
  });
  refresh(slug);
}

export async function duplicateWorkflowAction(slug: string, workflowId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const source = await db.workflow.findFirst({
    where: { id: workflowId, workspaceId: ctx.workspace.id },
    include: { nodes: true, edges: true },
  });
  if (!source) throw notFound('That workflow no longer exists.');

  const copy = await db.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
      data: {
        workspaceId: ctx.workspace.id,
        createdById: ctx.user.id,
        name: `${source.name.slice(0, 115)} copy`,
        description: source.description,
        viewport: source.viewport as Prisma.InputJsonValue,
        enabled: false,
        scheduleEnabled: false,
        scheduleWeekdays: source.scheduleWeekdays,
        scheduleHour: source.scheduleHour,
        scheduleMinute: source.scheduleMinute,
        timezone: ctx.workspace.timezone,
        nextRunAt: null,
      },
      select: { id: true, name: true },
    });

    const nodeIds = new Map(source.nodes.map((node) => [node.id, randomUUID()]));
    if (source.nodes.length) {
      await tx.workflowNode.createMany({
        data: source.nodes.map((node) => ({
          id: nodeIds.get(node.id)!,
          workflowId: workflow.id,
          workspaceId: ctx.workspace.id,
          type: node.type,
          name: node.name,
          config: node.config as Prisma.InputJsonValue,
          positionX: node.positionX,
          positionY: node.positionY,
          version: node.version,
        })),
      });
    }
    if (source.edges.length) {
      await tx.workflowEdge.createMany({
        data: source.edges.map((edge) => ({
          workflowId: workflow.id,
          workspaceId: ctx.workspace.id,
          sourceNodeId: nodeIds.get(edge.sourceNodeId)!,
          sourcePort: edge.sourcePort,
          targetNodeId: nodeIds.get(edge.targetNodeId)!,
          targetPort: edge.targetPort,
        })),
      });
    }
    return workflow;
  });

  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: 'workflow.duplicated',
    entityType: 'workflow',
    entityId: copy.id,
    metadata: { sourceWorkflowId: source.id, name: copy.name },
  });
  refresh(slug);
  return copy;
}

export async function setWorkflowArchivedAction(
  slug: string,
  workflowId: string,
  archived: boolean,
) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  const existing = await db.workflow.findFirst({
    where: { id: workflowId, workspaceId: ctx.workspace.id },
    select: { id: true },
  });
  if (!existing) throw notFound('That workflow no longer exists.');

  const updated = await db.workflow.update({
    where: { id: workflowId },
    data: {
      archivedAt: archived ? new Date() : null,
      // Restoring is intentionally manual: an archived schedule must never
      // silently resume unattended work.
      enabled: false,
      scheduleEnabled: false,
      nextRunAt: null,
    },
    select: { id: true, archivedAt: true },
  });
  await audit({
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    action: archived ? 'workflow.archived' : 'workflow.restored',
    entityType: 'workflow',
    entityId: workflowId,
  });
  refresh(slug, workflowId);
  return updated;
}

export type WorkflowTrimPreview =
  | {
      state: 'ready';
      asset: {
        id: string;
        type: 'AUDIO' | 'VIDEO';
        filename: string;
        duration: number;
        url: string;
        posterUrl: string | null;
      };
    }
  | { state: 'unavailable'; reason: string };

/**
 * Resolves only a deterministic design-time source. Random or generated values
 * deliberately do not pretend to be the media a future run will receive.
 */
export async function getWorkflowTrimPreviewAction(
  slug: string,
  nodeId: string,
): Promise<WorkflowTrimPreview> {
  const ctx = await requireWorkspace(slug, 'workflow:view');
  const target = await db.workflowNode.findFirst({
    where: { id: nodeId, workspaceId: ctx.workspace.id, type: 'AUDIO_TRIMMER' },
    select: { workflowId: true },
  });
  if (!target) throw notFound('That Trimmer step no longer exists.');

  const workflow = await db.workflow.findFirst({
    where: { id: target.workflowId, workspaceId: ctx.workspace.id },
    select: {
      nodes: { select: { id: true, type: true, config: true } },
      edges: {
        select: {
          sourceNodeId: true,
          sourcePort: true,
          targetNodeId: true,
          targetPort: true,
        },
      },
    },
  });
  if (!workflow) throw notFound('That workflow no longer exists.');

  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const incoming = workflow.edges.find(
    (edge) => edge.targetNodeId === nodeId && edge.targetPort === 'audio',
  );
  if (!incoming) {
    return { state: 'unavailable', reason: 'Connect a specific audio or video source to preview it.' };
  }

  const scalarId = await resolvePreviewScalar(
    incoming.sourceNodeId,
    incoming.sourcePort,
    byId,
    workflow.edges,
    ctx.workspace.id,
    new Set(),
  );
  if (!scalarId) {
    return {
      state: 'unavailable',
      reason: 'This source is random or generated at run time, so it cannot be previewed yet.',
    };
  }

  const asset = await db.mediaAsset.findFirst({
    where: {
      id: scalarId,
      workspaceId: ctx.workspace.id,
      status: 'READY',
      type: { in: ['AUDIO', 'VIDEO'] },
    },
    select: {
      id: true,
      type: true,
      filename: true,
      duration: true,
      storageKey: true,
      thumbnailKey: true,
    },
  });
  if (!asset || asset.duration == null) {
    return { state: 'unavailable', reason: 'The connected media is not ready to preview.' };
  }
  return {
    state: 'ready',
    asset: {
      id: asset.id,
      type: asset.type as 'AUDIO' | 'VIDEO',
      filename: asset.filename,
      duration: asset.duration,
      url: await storage().signedUrl(asset.storageKey, 3600),
      posterUrl: asset.thumbnailKey ? await storage().signedUrl(asset.thumbnailKey, 3600) : null,
    },
  };
}

type PreviewNode = {
  id: string;
  type: string;
  config: Prisma.JsonValue;
};
type PreviewEdge = {
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
};

async function resolvePreviewScalar(
  nodeId: string,
  port: string,
  nodes: Map<string, PreviewNode>,
  edges: PreviewEdge[],
  workspaceId: string,
  visiting: Set<string>,
): Promise<string | null> {
  const key = `${nodeId}:${port}`;
  if (visiting.has(key)) return null;
  visiting.add(key);
  const node = nodes.get(nodeId);
  const config = (node?.config ?? {}) as Record<string, unknown>;
  if (node?.type === 'MUSIC_SELECTOR' && port === 'audio') {
    return config.mode === 'specific' && typeof config.mediaAssetId === 'string'
      ? config.mediaAssetId
      : null;
  }
  if (node?.type !== 'PICK' || port !== 'item' || config.mode === 'random') return null;
  const incoming = edges.find(
    (edge) => edge.targetNodeId === nodeId && edge.targetPort === 'items',
  );
  if (!incoming) return null;
  const items = await resolvePreviewList(
    incoming.sourceNodeId,
    incoming.sourcePort,
    nodes,
    edges,
    workspaceId,
    visiting,
  );
  if (!items.length) return null;
  try {
    return selectItems(items, {
      mode: config.mode as 'first' | 'last' | 'index',
      count: 1,
      index: typeof config.index === 'number' ? config.index : 0,
      seed: 'preview',
    })[0] ?? null;
  } catch {
    return null;
  }
}

async function resolvePreviewList(
  nodeId: string,
  port: string,
  nodes: Map<string, PreviewNode>,
  edges: PreviewEdge[],
  workspaceId: string,
  visiting: Set<string>,
): Promise<string[]> {
  const node = nodes.get(nodeId);
  const config = (node?.config ?? {}) as Record<string, unknown>;
  if (node?.type === 'MEDIA_LIBRARY' && (port === 'audio' || port === 'videos')) {
    if (typeof config.assetId === 'string') return [config.assetId];
    const mediaType = port === 'audio' ? 'AUDIO' : 'VIDEO';
    let folderIds: string[] | null = null;
    if (typeof config.folderId === 'string') {
      const folders = await db.mediaFolder.findMany({
        where: { workspaceId },
        select: { id: true, parentId: true },
      });
      const selected = new Set([config.folderId]);
      if (config.includeSubfolders !== false) {
        for (let changed = true; changed;) {
          changed = false;
          for (const folder of folders) {
            if (folder.parentId && selected.has(folder.parentId) && !selected.has(folder.id)) {
              selected.add(folder.id);
              changed = true;
            }
          }
        }
      }
      folderIds = [...selected];
    }
    const assets = await db.mediaAsset.findMany({
      where: {
        workspaceId,
        status: 'READY',
        type: mediaType,
        ...(folderIds ? { folderId: { in: folderIds } } : {}),
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 1000,
    });
    return assets.map((asset) => asset.id);
  }
  if (node?.type === 'COMBINE_MEDIA' && port === 'media') {
    const order = Array.isArray(config.sourceOrder)
      ? config.sourceOrder.filter((item): item is string => typeof item === 'string')
      : ['media1', 'media2', 'media3', 'media4'];
    const combined: string[] = [];
    for (const input of order) {
      const incoming = edges.find(
        (edge) => edge.targetNodeId === nodeId && edge.targetPort === input,
      );
      if (incoming) {
        combined.push(...await resolvePreviewList(
          incoming.sourceNodeId,
          incoming.sourcePort,
          nodes,
          edges,
          workspaceId,
          new Set(visiting),
        ));
      }
    }
    return combined;
  }
  if (node?.type === 'PICK' && port === 'selection' && config.mode !== 'random') {
    const incoming = edges.find(
      (edge) => edge.targetNodeId === nodeId && edge.targetPort === 'items',
    );
    if (!incoming) return [];
    const items = await resolvePreviewList(
      incoming.sourceNodeId,
      incoming.sourcePort,
      nodes,
      edges,
      workspaceId,
      visiting,
    );
    try {
      return selectItems(items, {
        mode: config.mode as 'first' | 'last' | 'index',
        count: typeof config.count === 'number' ? config.count : 1,
        index: typeof config.index === 'number' ? config.index : 0,
        seed: 'preview',
      });
    } catch {
      return [];
    }
  }
  return [];
}

// ---------------------------------------------------------------- nodes

export async function addNodeAction(
  slug: string,
  workflowId: string,
  input: { type: string; positionX: number; positionY: number },
) {
  const ctx = await requireWorkspace(slug, 'workflow:edit');
  if (!isCreatableNodeType(input.type)) throw invalid('That step type is not available for new workflows.');
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
      config: parseConfig(input.type, {}) as Prisma.InputJsonValue,
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
      if (error instanceof z.ZodError) {
        const validation = zodValidationMessage(error);
        throw invalid(validation.message, validation.fields);
      }
      throw invalid('Those settings are not valid for this step.');
    }

    const saveIssue = nodeSaveConfigIssue(node.type, config);
    if (saveIssue) throw invalid(saveIssue.message, saveIssue.fields);
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

      const outPort = getNodePorts(source.type, source.config, 'outputs').find((p) => p.id === input.sourcePort);
      const inPort = getNodePorts(target.type, target.config, 'inputs').find((p) => p.id === input.targetPort);
      if (!outPort || !inPort) throw invalid('That connection point no longer exists.');

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

      // Last, so a generic port resolves over a graph that is already known to
      // be loop-free and single-writer.
      const incompatible = checkAddedEdge({ nodes, edges }, input);
      if (incompatible) throw invalid(incompatible.reason);

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

/**
 * One step's recorded output, for review.
 *
 * Fetched on demand rather than carried by the run poll: the poll runs every
 * couple of seconds for the life of a run, and an idea step's output holds a
 * full prompt list, so putting it in that payload would repeat kilobytes
 * nobody is reading. Almost nobody opens this, and the ones who do open it
 * once.
 */
export async function getNodeRunOutputAction(
  slug: string,
  nodeRunId: string,
): Promise<{ nodeName: string; nodeType: string; output: unknown }> {
  const ctx = await requireWorkspace(slug, 'workflow:view');
  const nodeRun = await db.workflowNodeRun.findFirst({
    where: { id: nodeRunId, workspaceId: ctx.workspace.id },
    select: { nodeName: true, nodeType: true, output: true },
  });
  if (!nodeRun) throw new Error('That step is no longer part of this run.');
  return { nodeName: nodeRun.nodeName, nodeType: nodeRun.nodeType, output: nodeRun.output };
}

/**
 * The workspace's images, with a thumbnail to show.
 *
 * On demand rather than on the workflow page: that page already loads up to a
 * thousand asset rows for the pickers, and signing a URL for every one of them
 * on every load — to fill a grid almost nobody opens — is work for nothing.
 */
export async function listReferenceImagesAction(
  slug: string,
): Promise<{ id: string; filename: string; url: string }[]> {
  const ctx = await requireWorkspace(slug, 'workflow:view');
  const assets = await db.mediaAsset.findMany({
    where: { workspaceId: ctx.workspace.id, status: 'READY', type: 'IMAGE' },
    select: { id: true, filename: true, thumbnailKey: true, storageKey: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const store = storage();
  return Promise.all(assets.map(async (asset) => ({
    id: asset.id,
    filename: asset.filename,
    url: await store.signedUrl(asset.thumbnailKey ?? asset.storageKey),
  })));
}

export async function retryNodeAction(slug: string, nodeRunId: string) {
  const ctx = await requireWorkspace(slug, 'workflow:run');
  await retryWorkflowNode(nodeRunId, ctx.workspace.id);
  revalidatePath(`/w/${slug}/workflows`);
}
