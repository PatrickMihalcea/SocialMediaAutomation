import { getDefinition, getNodePorts } from '@/lib/workflows/definitions';
import {
  checkCompatible,
  describePortType,
  type Incompatibility,
  type PortType,
} from '@/lib/workflows/ports';

/**
 * Graph-aware port typing.
 *
 * Most ports declare a fixed type, so `checkCompatible` alone is enough. A
 * generic output (`followsInput`) instead carries whatever reaches the input it
 * follows, which is what lets one Pick one step serve image, video and audio
 * lists — the alternative being a near-identical node per media kind.
 *
 * Resolving against the graph means an edge's validity depends on the wiring
 * upstream of it, so every check here validates the whole graph rather than the
 * one edge in front of it. Adding an edge can complete a generic step and so
 * settle the type of edges already leaving it; that has to be caught at the
 * point of the drag, not three steps later at run time.
 */

export interface ResolutionNode {
  id: string;
  type: string;
  config?: unknown;
  /** Used in messages only. */
  name?: string;
}

export interface ResolutionEdge {
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

export interface ResolutionGraph {
  nodes: ResolutionNode[];
  edges: ResolutionEdge[];
}

export type PortResolution =
  /** A concrete type, ready to compare. */
  | { state: 'type'; type: PortType }
  /** Generic, and the input it follows has nothing connected yet. */
  | { state: 'awaiting'; nodeName: string; inputLabel: string }
  /** The node type or port id is not in this version of the catalogue. */
  | { state: 'missing' };

/** The type an output port carries in this graph. */
export function resolveOutputType(
  graph: ResolutionGraph,
  nodeId: string,
  portId: string,
): PortResolution {
  return resolve(graph, nodeId, portId, new Set());
}

function resolve(
  graph: ResolutionGraph,
  nodeId: string,
  portId: string,
  visiting: Set<string>,
): PortResolution {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  const port = node ? getNodePorts(node.type, node.config, 'outputs').find((p) => p.id === portId) : undefined;
  if (!node || !port) return { state: 'missing' };
  if (!port.followsInput) return { state: 'type', type: port.type };

  const followed = getNodePorts(node.type, node.config, 'inputs').find((p) => p.id === port.followsInput);
  if (!followed) return { state: 'missing' };

  const awaiting: PortResolution = {
    state: 'awaiting',
    nodeName: node.name ?? getDefinition(node.type)!.label,
    inputLabel: followed.label,
  };

  // A cycle is rejected elsewhere; here it only has to not hang.
  const key = `${nodeId}:${portId}`;
  if (visiting.has(key)) return awaiting;
  visiting.add(key);

  const incoming = graph.edges.find(
    (edge) => edge.targetNodeId === nodeId && edge.targetPort === port.followsInput,
  );
  if (!incoming) return awaiting;

  const upstream = resolve(graph, incoming.sourceNodeId, incoming.sourcePort, visiting);
  if (upstream.state !== 'type') return upstream.state === 'missing' ? awaiting : upstream;

  // The kind passes through; the arity is this port's own.
  return { state: 'type', type: { ...upstream.type, list: port.type.list } };
}

/** Is this one edge well-typed, given everything else in the graph? */
export function checkEdge(graph: ResolutionGraph, edge: ResolutionEdge): Incompatibility | null {
  const target = graph.nodes.find((node) => node.id === edge.targetNodeId);
  const input = target
    ? getNodePorts(target.type, target.config, 'inputs').find((p) => p.id === edge.targetPort)
    : undefined;
  if (!target || !input) return { reason: 'That connection point no longer exists.' };

  const source = resolveOutputType(graph, edge.sourceNodeId, edge.sourcePort);
  if (source.state === 'missing') return { reason: 'That connection point no longer exists.' };
  if (source.state === 'awaiting') {
    return {
      reason: `Connect the ${source.inputLabel} input of "${source.nodeName}" first — until then it does not know what kind of ${describePortType(input.type)} it passes on.`,
    };
  }
  return checkCompatible(source.type, input.type);
}

/**
 * The first badly-typed edge in the graph, if there is one.
 *
 * An edge whose port no longer exists is skipped rather than reported. A port
 * can be retired by a release — titles stopped being wired when they started
 * travelling with the media — and the edges saved against it outlive the
 * deploy that removed it. They carry nothing, because no step reads a port that
 * is not declared, so the graph is sound without them. Failing here instead
 * made every workflow holding one refuse to run, with a message naming a
 * connection the canvas could no longer even draw.
 *
 * Adding an edge is different and still refuses: `checkAddedEdge` reports it,
 * because a port that does not exist is not somewhere to connect to.
 */
export function checkGraphTypes(graph: ResolutionGraph): Incompatibility | null {
  for (const edge of graph.edges) {
    if (portMissing(graph, edge)) continue;
    const problem = checkEdge(graph, edge);
    if (problem) return { reason: describeEdgeProblem(graph, edge, problem) };
  }
  return null;
}

/** Either end naming a port the step no longer declares. */
function portMissing(graph: ResolutionGraph, edge: ResolutionEdge): boolean {
  const end = (nodeId: string, portId: string, side: 'inputs' | 'outputs') => {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return true;
    return !getNodePorts(node.type, node.config, side).some((port) => port.id === portId);
  };
  return end(edge.targetNodeId, edge.targetPort, 'inputs')
    || end(edge.sourceNodeId, edge.sourcePort, 'outputs');
}

/**
 * Would adding `candidate` leave every edge well-typed? Checks the candidate
 * itself first so its own mismatch is the message the user gets, then the rest
 * of the graph, because completing a generic step can settle — or break — the
 * edges already leaving it.
 */
export function checkAddedEdge(
  graph: ResolutionGraph,
  candidate: ResolutionEdge,
): Incompatibility | null {
  const next: ResolutionGraph = { nodes: graph.nodes, edges: [...graph.edges, candidate] };
  const own = checkEdge(next, candidate);
  if (own) return own;

  for (const edge of graph.edges) {
    const problem = checkEdge(next, edge);
    if (problem) {
      return { reason: `That would break a later connection. ${describeEdgeProblem(next, edge, problem)}` };
    }
  }
  return null;
}

function describeEdgeProblem(
  graph: ResolutionGraph,
  edge: ResolutionEdge,
  problem: Incompatibility,
): string {
  const target = graph.nodes.find((node) => node.id === edge.targetNodeId);
  const label = target?.name ?? (target ? getDefinition(target.type)?.label : null);
  return label ? `Into "${label}": ${problem.reason}` : problem.reason;
}
