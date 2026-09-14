/**
 * Graph maths for workflow DAGs. Pure functions over plain node/edge shapes —
 * no Prisma, no io — so the scheduler's ordering rules can be tested directly
 * and reused against both the live tables and a run's frozen snapshot.
 */

export interface GraphNode {
  id: string;
  type: string;
}

export interface GraphEdge {
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class CycleError extends Error {
  /// The nodes still holding unmet dependencies — i.e. the cycle.
  readonly nodeIds: string[];
  constructor(nodeIds: string[]) {
    super('That connection would create a loop. Workflows must flow one way.');
    this.name = 'CycleError';
    this.nodeIds = nodeIds;
  }
}

/**
 * How many *upstream nodes* each node is waiting on. Seeds
 * WorkflowNodeRun.pendingDeps.
 *
 * Counts distinct source nodes, not edges. Two nodes can be joined by more than
 * one edge — a slideshow feeds both `video` and `segments` to an overlay — and
 * that is still one dependency, satisfied once, by one upstream completing.
 * Counting edges here would leave the target waiting on a second completion
 * that never comes, which reads downstream as a cycle.
 */
export function indegrees(graph: Graph): Map<string, number> {
  const counts = new Map(graph.nodes.map((n) => [n.id, 0]));
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    // An edge to a node outside the graph is ignored rather than counted —
    // otherwise a stale edge would leave a node permanently un-runnable.
    if (!counts.has(edge.targetNodeId) || !counts.has(edge.sourceNodeId)) continue;
    const pair = `${edge.sourceNodeId}->${edge.targetNodeId}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    counts.set(edge.targetNodeId, (counts.get(edge.targetNodeId) ?? 0) + 1);
  }
  return counts;
}

export function successorsOf(graph: Graph, nodeId: string): string[] {
  return unique(graph.edges.filter((e) => e.sourceNodeId === nodeId).map((e) => e.targetNodeId));
}

export function predecessorsOf(graph: Graph, nodeId: string): string[] {
  return unique(graph.edges.filter((e) => e.targetNodeId === nodeId).map((e) => e.sourceNodeId));
}

/** Incoming edges, which is how a node's inputs are resolved at run time. */
export function incomingEdges(graph: Graph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.targetNodeId === nodeId);
}

/**
 * Every node reachable from `nodeId`, excluding itself. Used to mark the
 * descendants of a failed node SKIPPED so a run cannot hang waiting on work
 * that can never start.
 */
export function descendantsOf(graph: Graph, nodeId: string): string[] {
  const seen = new Set<string>();
  const stack = [...successorsOf(graph, nodeId)];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...successorsOf(graph, current));
  }
  seen.delete(nodeId);
  return [...seen];
}

/** True when `to` is reachable from `from`. The cycle test for a proposed edge. */
export function reaches(edges: GraphEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  const graph: Graph = { nodes: nodesFromEdges(edges), edges };
  return descendantsOf(graph, from).includes(to);
}

/**
 * Kahn's algorithm. Returns nodes in an order where every node appears after
 * all of its dependencies; throws CycleError naming the offending nodes.
 *
 * The executor does not actually walk this order — it fans out on dependency
 * counters so independent branches run in parallel — but the same traversal is
 * what proves the graph is acyclic before a run starts.
 */
export function topoOrder(graph: Graph): string[] {
  const remaining = indegrees(graph);
  const ready = graph.nodes.filter((n) => (remaining.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];

  while (ready.length) {
    const current = ready.shift()!;
    order.push(current);
    for (const next of successorsOf(graph, current)) {
      const left = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, left);
      if (left === 0) ready.push(next);
    }
  }

  if (order.length !== graph.nodes.length) {
    throw new CycleError(graph.nodes.map((n) => n.id).filter((id) => !order.includes(id)));
  }
  return order;
}

export function assertAcyclic(graph: Graph): void {
  topoOrder(graph);
}

/**
 * Nodes with no incoming edges. These are the roots a run starts from, and a
 * graph with none is either empty or entirely cyclic.
 */
export function rootsOf(graph: Graph): string[] {
  const counts = indegrees(graph);
  return graph.nodes.filter((n) => (counts.get(n.id) ?? 0) === 0).map((n) => n.id);
}

function nodesFromEdges(edges: GraphEdge[]): GraphNode[] {
  const ids = unique(edges.flatMap((e) => [e.sourceNodeId, e.targetNodeId]));
  return ids.map((id) => ({ id, type: '' }));
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];
