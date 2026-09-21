import 'server-only';

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { invalid, notFound } from '@/lib/errors';
import {
  findPort,
  getDefinition,
  isCreatableNodeType,
  nodeSaveConfigIssue,
  parseConfig,
} from '@/lib/workflows/definitions';
import {
  validateProposedGraph,
  type ProposedWorkflowEdge,
  type ProposedWorkflowNode,
  type WorkflowGraphEdit,
} from '@/lib/workflows/assistant-graph';
import { reaches } from '@/lib/workflows/graph';
import { checkGraphTypes } from '@/lib/workflows/port-resolution';
import { computeNextRun, scheduleTimesOf } from '@/lib/workflows/schedule';

export async function createWorkflowFromProposal(input: {
  workspaceId: string;
  userId: string;
  name: string;
  description?: string | null;
  scheduleEnabled?: boolean;
  scheduleWeekdays?: number[];
  scheduleHour?: number;
  scheduleMinute?: number;
  nodes: ProposedWorkflowNode[];
  edges: ProposedWorkflowEdge[];
}): Promise<{ id: string; name: string }> {
  let graph: { nodes: ProposedWorkflowNode[]; edges: ProposedWorkflowEdge[] };
  try {
    graph = validateProposedGraph(input.nodes, input.edges);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : 'That workflow graph is not valid.');
  }

  const workspace = await db.workspace.findFirst({
    where: { id: input.workspaceId },
    select: { timezone: true },
  });
  if (!workspace) throw notFound('That workspace is unavailable.');

  const name = input.name.trim();
  if (name.length < 2) throw invalid('Give the workflow a name.');

  const scheduleEnabled = input.scheduleEnabled ?? false;
  const scheduleWeekdays = input.scheduleWeekdays ?? [];
  const scheduleHour = input.scheduleHour ?? 9;
  const scheduleMinute = input.scheduleMinute ?? 0;
  assertScheduleIsSafe(graph.nodes, scheduleEnabled, scheduleWeekdays);

  const created = await db.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
      data: {
        workspaceId: input.workspaceId,
        createdById: input.userId,
        name,
        description: input.description?.trim() || null,
        timezone: workspace.timezone,
        scheduleEnabled,
        scheduleWeekdays,
        scheduleHour,
        scheduleMinute,
      },
    });

    const ids = new Map<string, string>();
    for (const node of graph.nodes) {
      const created = await tx.workflowNode.create({
        data: {
          workflowId: workflow.id,
          workspaceId: input.workspaceId,
          type: node.type,
          name: node.name ?? node.type,
          config: node.config as Prisma.InputJsonValue,
          positionX: node.positionX ?? 40,
          positionY: node.positionY ?? 40,
        },
        select: { id: true },
      });
      ids.set(node.key, created.id);
    }

    for (const edge of graph.edges) {
      await tx.workflowEdge.create({
        data: {
          workflowId: workflow.id,
          workspaceId: input.workspaceId,
          sourceNodeId: ids.get(edge.sourceKey)!,
          sourcePort: edge.sourcePort,
          targetNodeId: ids.get(edge.targetKey)!,
          targetPort: edge.targetPort,
        },
      });
    }

    // The assistant proposes one time. Stored as a list of one all the same,
    // so the column is never empty and nothing has to fall back to read it.
    const scheduleTimes = scheduleTimesOf({ scheduleHour, scheduleMinute });
    const nextRunAt = computeNextRun({
      scheduleEnabled,
      scheduleWeekdays,
      scheduleTimes,
      scheduleHour,
      scheduleMinute,
      timezone: workspace.timezone,
    });
    await tx.workflow.update({
      where: { id: workflow.id },
      data: { scheduleTimes, nextRunAt },
    });

    return { id: workflow.id, name: workflow.name };
  });

  await audit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: 'workflow.created',
    entityType: 'workflow',
    entityId: created.id,
    metadata: { name, source: 'assistant' },
  });

  return created;
}

export async function updateWorkflowFromProposal(input: {
  workspaceId: string;
  userId: string;
  workflowId: string;
  name?: string;
  description?: string | null;
  scheduleEnabled?: boolean;
  scheduleWeekdays?: number[];
  scheduleHour?: number;
  scheduleMinute?: number;
  nodeUpdates?: Array<{ nodeId: string; name?: string; config?: Record<string, unknown> }>;
  graphEdits?: WorkflowGraphEdit[];
}): Promise<{ id: string; name: string }> {
  const workspace = await db.workspace.findFirst({
    where: { id: input.workspaceId },
    select: { timezone: true },
  });
  if (!workspace) throw notFound('That workspace is unavailable.');

  const result = await db.$transaction(async (tx) => {
    const existing = await tx.workflow.findFirst({
      where: { id: input.workflowId, workspaceId: input.workspaceId },
      include: { nodes: true, edges: true },
    });
    if (!existing) throw notFound('That workflow is not available in this workspace.');

    const merged = {
      ...existing,
      name: input.name?.trim() || existing.name,
      description: input.description === undefined ? existing.description : (input.description?.trim() || null),
      scheduleEnabled: input.scheduleEnabled ?? existing.scheduleEnabled,
      scheduleWeekdays: input.scheduleWeekdays ?? existing.scheduleWeekdays,
      scheduleHour: input.scheduleHour ?? existing.scheduleHour,
      scheduleMinute: input.scheduleMinute ?? existing.scheduleMinute,
      timezone: workspace.timezone,
    };
    // The assistant speaks in one time. It replaces the list only when it
    // actually proposed one — an edit that left the schedule alone must not
    // collapse a workflow's several slots down to the earliest.
    const proposesTime = input.scheduleHour !== undefined || input.scheduleMinute !== undefined;
    if (proposesTime) {
      merged.scheduleTimes = scheduleTimesOf({
        scheduleHour: merged.scheduleHour,
        scheduleMinute: merged.scheduleMinute,
      });
    }
    if (merged.name.length < 2) throw invalid('Give the workflow a name.');

    // The older nodeUpdates field remains accepted for stored proposals. New
    // proposals use graphEdits so the assistant can change graph structure too.
    const graphEdits: WorkflowGraphEdit[] = [
      ...(input.nodeUpdates ?? []).map((update) => ({
        operation: 'update_node' as const,
        ...update,
      })),
      ...(input.graphEdits ?? []),
    ];
    const stateNodes = new Map(existing.nodes.map((node) => [
      node.id,
      { ref: node.id, type: node.type, name: node.name, config: node.config as Record<string, unknown> },
    ]));
    let stateEdges = existing.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      sourcePort: edge.sourcePort,
      targetNodeId: edge.targetNodeId,
      targetPort: edge.targetPort,
    }));
    const added: Extract<WorkflowGraphEdit, { operation: 'add_node' }>[] = [];
    const updated: Extract<WorkflowGraphEdit, { operation: 'update_node' }>[] = [];
    const removed = new Set<string>();
    const disconnected = new Set<string>();
    const connected: Extract<WorkflowGraphEdit, { operation: 'connect' }>[] = [];

    for (const edit of graphEdits) {
      if (edit.operation === 'add_node') {
        if (stateNodes.has(edit.key)) throw invalid(`Two steps share the key "${edit.key}".`);
        if (!isCreatableNodeType(edit.type)) {
          throw invalid('That step type is not available for new workflows.');
        }
        const config = validatedNodeConfig(edit.type, edit.name ?? getDefinition(edit.type)!.label, edit.config);
        stateNodes.set(edit.key, {
          ref: edit.key,
          type: edit.type,
          name: edit.name?.trim() || getDefinition(edit.type)!.label,
          config,
        });
        added.push({ ...edit, config });
        continue;
      }
      if (edit.operation === 'update_node') {
        const node = stateNodes.get(edit.nodeId);
        if (!node || removed.has(edit.nodeId)) throw invalid('A proposed step is not part of that workflow.');
        const config = edit.config === undefined
          ? node.config
          : validatedNodeConfig(node.type, edit.name ?? node.name, edit.config);
        stateNodes.set(edit.nodeId, {
          ...node,
          name: edit.name?.trim() || node.name,
          config,
        });
        updated.push({ ...edit, config: edit.config === undefined ? undefined : config });
        continue;
      }
      if (edit.operation === 'remove_node') {
        if (!stateNodes.has(edit.nodeId)) throw invalid('A proposed step is not part of that workflow.');
        removed.add(edit.nodeId);
        stateNodes.delete(edit.nodeId);
        stateEdges = stateEdges.filter(
          (edge) => edge.sourceNodeId !== edit.nodeId && edge.targetNodeId !== edit.nodeId,
        );
        continue;
      }
      if (edit.operation === 'disconnect') {
        if (!stateEdges.some((edge) => edge.id === edit.edgeId)) {
          throw invalid('A proposed connection is not part of that workflow.');
        }
        disconnected.add(edit.edgeId);
        stateEdges = stateEdges.filter((edge) => edge.id !== edit.edgeId);
        continue;
      }
      const source = stateNodes.get(edit.sourceNodeRef);
      const target = stateNodes.get(edit.targetNodeRef);
      if (!source || !target) throw invalid('A proposed connection points to a missing step.');
      if (source.ref === target.ref) throw invalid('A step cannot connect to itself.');
      const output = findPort(source.type, edit.sourcePort, 'outputs');
      const targetInput = findPort(target.type, edit.targetPort, 'inputs');
      if (!output || !targetInput) throw invalid('A proposed connection uses a port that does not exist.');
      stateEdges.push({
        id: `new:${connected.length}`,
        sourceNodeId: edit.sourceNodeRef,
        sourcePort: edit.sourcePort,
        targetNodeId: edit.targetNodeRef,
        targetPort: edit.targetPort,
      });
      connected.push(edit);
    }

    for (const edge of stateEdges) {
      const occupied = stateEdges.filter(
        (candidate) =>
          candidate.targetNodeId === edge.targetNodeId
          && candidate.targetPort === edge.targetPort,
      );
      if (occupied.length > 1) throw invalid('Two connections cannot write to the same input.');
      const others = stateEdges.filter((candidate) => candidate.id !== edge.id);
      if (reaches(others, edge.targetNodeId, edge.sourceNodeId)) {
        throw invalid('That connection would create a loop. Workflows must flow one way.');
      }
    }
    if (graphEdits.length > 0 || merged.scheduleEnabled) {
      for (const node of stateNodes.values()) {
        const definition = getDefinition(node.type)!;
        const missing = definition.inputs.find(
          (port) =>
            port.required
            && !stateEdges.some(
              (edge) => edge.targetNodeId === node.ref && edge.targetPort === port.id,
            ),
        );
        if (missing) throw invalid(`"${node.name}" needs a connection to its ${missing.label} input.`);
      }
    }

    if (graphEdits.length > 0) {
      const mistyped = checkGraphTypes({
        nodes: [...stateNodes.values()].map((node) => ({
          id: node.ref,
          type: node.type,
          name: node.name,
        })),
        edges: stateEdges,
      });
      if (mistyped) throw invalid(mistyped.reason);
    }
    assertScheduleIsSafe(
      [...stateNodes.values()],
      merged.scheduleEnabled,
      merged.scheduleWeekdays,
    );

    await tx.workflow.update({
      where: { id: input.workflowId },
      data: {
        name: merged.name,
        description: merged.description,
        scheduleEnabled: merged.scheduleEnabled,
        scheduleWeekdays: merged.scheduleWeekdays,
        ...(proposesTime ? { scheduleTimes: merged.scheduleTimes } : {}),
        scheduleHour: merged.scheduleHour,
        scheduleMinute: merged.scheduleMinute,
        timezone: workspace.timezone,
        nextRunAt: computeNextRun(merged),
      },
    });
    const createdIds = new Map<string, string>();
    for (const addition of added) {
      const node = await tx.workflowNode.create({
        data: {
          workflowId: input.workflowId,
          workspaceId: input.workspaceId,
          type: addition.type,
          name: addition.name?.trim() || getDefinition(addition.type)!.label,
          config: addition.config as Prisma.InputJsonValue,
          positionX: addition.positionX ?? 40,
          positionY: addition.positionY ?? 40,
        },
        select: { id: true },
      });
      createdIds.set(addition.key, node.id);
    }
    for (const update of updated) {
      await tx.workflowNode.update({
        where: { id: update.nodeId },
        data: {
          name: update.name?.trim(),
          config: update.config as Prisma.InputJsonValue | undefined,
          version: update.config !== undefined ? { increment: 1 } : undefined,
        },
      });
    }
    if (disconnected.size) {
      await tx.workflowEdge.deleteMany({
        where: { id: { in: [...disconnected] }, workflowId: input.workflowId, workspaceId: input.workspaceId },
      });
    }
    if (removed.size) {
      await tx.workflowNode.deleteMany({
        where: { id: { in: [...removed] }, workflowId: input.workflowId, workspaceId: input.workspaceId },
      });
    }
    for (const connection of connected) {
      const survives = stateEdges.some(
        (edge) =>
          edge.id.startsWith('new:')
          && edge.sourceNodeId === connection.sourceNodeRef
          && edge.sourcePort === connection.sourcePort
          && edge.targetNodeId === connection.targetNodeRef
          && edge.targetPort === connection.targetPort,
      );
      if (!survives) continue;
      await tx.workflowEdge.create({
        data: {
          workflowId: input.workflowId,
          workspaceId: input.workspaceId,
          sourceNodeId: createdIds.get(connection.sourceNodeRef) ?? connection.sourceNodeRef,
          sourcePort: connection.sourcePort,
          targetNodeId: createdIds.get(connection.targetNodeRef) ?? connection.targetNodeRef,
          targetPort: connection.targetPort,
        },
      });
    }
    return { id: existing.id, name: merged.name };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await audit({
    workspaceId: input.workspaceId,
    userId: input.userId,
    action: 'workflow.updated',
    entityType: 'workflow',
    entityId: result.id,
    metadata: { source: 'assistant' },
  });

  return result;
}

function validatedNodeConfig(type: string, name: string, raw: unknown): Record<string, unknown> {
  try {
    const config = parseConfig(type, raw) as Record<string, unknown>;
    const issue = nodeSaveConfigIssue(type, config);
    if (issue) throw invalid(issue.message, issue.fields);
    return config;
  } catch (error) {
    if (error instanceof Error && error.name === 'AppError') throw error;
    throw invalid(`The settings on "${name}" are not valid.`);
  }
}

function assertScheduleIsSafe(
  nodes: Array<{ type: string; name?: string; config: unknown }>,
  scheduleEnabled: boolean,
  scheduleWeekdays: number[],
) {
  if (!scheduleEnabled) return;
  if (scheduleWeekdays.length === 0) {
    throw invalid('Choose at least one weekday before enabling the workflow schedule.');
  }
  const unattendedPublish = nodes.find((node) => {
    if (node.type !== 'PUBLISH') return false;
    const config = node.config as { requireApproval?: boolean };
    return config.requireApproval === false;
  });
  if (unattendedPublish) {
    throw invalid(
      `"${unattendedPublish.name ?? 'Publish'}" must require approval before this workflow can run on a schedule.`,
    );
  }
}
