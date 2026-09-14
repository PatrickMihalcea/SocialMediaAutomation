import { findPort } from '@/lib/workflows/definitions';

export interface ConnectionEndpoint {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  portId: string;
}

export interface ConnectionDescription {
  title: string;
  ariaLabel: string;
  source: ConnectionEndpoint;
  target: ConnectionEndpoint;
}

type NodeLookup = Map<string, { name: string; type: string }>;

/**
 * Human-readable labels for a canvas connection — used in the sidebar, context
 * menu, and React Flow aria-labels.
 */
export function describeConnection(
  edge: {
    sourceNodeId: string;
    sourcePort: string;
    targetNodeId: string;
    targetPort: string;
  },
  nodes: NodeLookup,
): ConnectionDescription {
  const sourceNode = nodes.get(edge.sourceNodeId);
  const targetNode = nodes.get(edge.targetNodeId);
  const sourceName = sourceNode?.name ?? shortId(edge.sourceNodeId);
  const targetName = targetNode?.name ?? shortId(edge.targetNodeId);
  const sourcePort = portLabel(sourceNode?.type, edge.sourcePort, 'outputs');
  const targetPort = portLabel(targetNode?.type, edge.targetPort, 'inputs');

  const sourceLine = `${sourceName} · ${sourcePort}`;
  const targetLine = `${targetName} · ${targetPort}`;

  return {
    title: `${sourceLine} → ${targetLine}`,
    ariaLabel: `Connection from ${sourceName} ${sourcePort} to ${targetName} ${targetPort}`,
    source: {
      nodeId: edge.sourceNodeId,
      nodeName: sourceName,
      nodeType: sourceNode?.type ?? '',
      portId: edge.sourcePort,
    },
    target: {
      nodeId: edge.targetNodeId,
      nodeName: targetName,
      nodeType: targetNode?.type ?? '',
      portId: edge.targetPort,
    },
  };
}

function portLabel(type: string | undefined, portId: string, direction: 'inputs' | 'outputs'): string {
  if (!type) return portId;
  return findPort(type, portId, direction)?.label ?? portId;
}

const shortId = (id: string) => id.slice(0, 8);
