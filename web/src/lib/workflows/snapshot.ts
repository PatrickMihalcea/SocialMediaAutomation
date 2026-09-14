import type { WorkflowEdge, WorkflowNode } from '@prisma/client';
import type { Graph } from '@/lib/workflows/graph';

/**
 * The frozen copy of a graph that a run executes against.
 *
 * Every scheduling decision reads the snapshot rather than the live tables. That
 * is what lets someone keep editing the canvas while a run is in flight without
 * the scheduler losing track of a dependency it already counted, and what makes
 * run history mean something a month later.
 */
export interface SnapshotNode {
  id: string;
  type: string;
  name: string;
  config: unknown;
  version: number;
  positionX: number;
  positionY: number;
}

export interface SnapshotEdge {
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

export interface WorkflowSnapshot {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  /** Bumped if the snapshot shape itself ever changes. */
  version: 1;
}

export function buildSnapshot(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowSnapshot {
  return {
    version: 1,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      config: node.config,
      version: node.version,
      positionX: node.positionX,
      positionY: node.positionY,
    })),
    edges: edges.map((edge) => ({
      sourceNodeId: edge.sourceNodeId,
      sourcePort: edge.sourcePort,
      targetNodeId: edge.targetNodeId,
      targetPort: edge.targetPort,
    })),
  };
}

/** Snapshot JSON read back off a run row, narrowed for the graph helpers. */
export function toGraph(snapshot: WorkflowSnapshot): Graph {
  return {
    nodes: snapshot.nodes.map((n) => ({ id: n.id, type: n.type })),
    edges: snapshot.edges,
  };
}

export function readSnapshot(value: unknown): WorkflowSnapshot {
  const snapshot = value as WorkflowSnapshot | null;
  if (!snapshot || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) {
    throw new Error('This run has no readable graph snapshot.');
  }
  return snapshot;
}
