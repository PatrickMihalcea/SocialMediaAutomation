'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Badge, Button, StatusMessage } from '@/bridge88/components';
import {
  CATEGORY_LABEL,
  NODE_DEFINITIONS,
  type NodeCategory,
  getDefinition,
} from '@/lib/workflows/definitions';
import { checkCompatible } from '@/lib/workflows/ports';
import {
  addNodeAction,
  connectNodesAction,
  deleteNodeAction,
  disconnectAction,
  runWorkflowAction,
  saveNodePositionsAction,
} from '@/app/actions/workflows';
import { NodeConfigPanel } from '@/components/workflow-config-panel';

export interface CanvasNode {
  id: string;
  type: string;
  name: string;
  config: unknown;
  positionX: number;
  positionY: number;
}

export interface CanvasEdge {
  id: string;
  sourceNodeId: string;
  sourcePort: string;
  targetNodeId: string;
  targetPort: string;
}

type StepData = { label: string; type: string };

/**
 * The pipeline editor.
 *
 * React Flow owns drag, pan, zoom and edge routing; everything it renders is an
 * ordinary Bridge88 component, so the canvas looks like the rest of the app
 * rather than like a third-party widget. Its own CSS variables are re-pointed at
 * the design tokens below.
 */
export function WorkflowCanvas(props: {
  slug: string;
  workflowId: string;
  initialNodes: CanvasNode[];
  initialEdges: CanvasEdge[];
  canEdit: boolean;
  canRun: boolean;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  slug,
  workflowId,
  initialNodes,
  initialEdges,
  canEdit,
  canRun,
}: {
  slug: string;
  workflowId: string;
  initialNodes: CanvasNode[];
  initialEdges: CanvasEdge[];
  canEdit: boolean;
  canRun: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const configs = useRef(new Map(initialNodes.map((n) => [n.id, n])));

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StepData>>(
    initialNodes.map(toFlowNode),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges.map(toFlowEdge));

  /**
   * Refuses an incompatible drop before the pointer is released, using the same
   * function the server action re-checks with. The client copy is a courtesy;
   * the server one is the control.
   */
  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const source = configs.current.get(connection.source);
    const target = configs.current.get(connection.target);
    if (!source || !target) return false;

    const out = getDefinition(source.type)?.outputs.find((p) => p.id === connection.sourceHandle);
    const input = getDefinition(target.type)?.inputs.find((p) => p.id === connection.targetHandle);
    if (!out || !input) return false;
    return checkCompatible(out.type, input.type) === null;
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canEdit) return;
      setError('');
      startTransition(async () => {
        try {
          const edge = await connectNodesAction(slug, workflowId, {
            sourceNodeId: connection.source!,
            sourcePort: connection.sourceHandle!,
            targetNodeId: connection.target!,
            targetPort: connection.targetHandle!,
          });
          setEdges((current) => addEdge({ ...connection, id: edge.id }, current));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Those steps could not be connected.');
        }
      });
    },
    [canEdit, slug, workflowId, setEdges],
  );

  /** One write per drag, on release — not one per pointer frame. */
  const persistPositions = useCallback(() => {
    if (!canEdit) return;
    void saveNodePositionsAction(
      slug,
      workflowId,
      nodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
    );
  }, [canEdit, nodes, slug, workflowId]);

  function addStep(type: string) {
    setError('');
    startTransition(async () => {
      try {
        // Dropped into open space near the middle rather than on top of an
        // existing node, so a new step is always visible.
        const created = await addNodeAction(slug, workflowId, {
          type,
          positionX: 120 + (nodes.length % 4) * 300,
          positionY: 120 + Math.floor(nodes.length / 4) * 220,
        });
        configs.current.set(created.id, created as unknown as CanvasNode);
        setNodes((current) => [...current, toFlowNode(created as unknown as CanvasNode)]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That step could not be added.');
      }
    });
  }

  function removeStep(id: string) {
    startTransition(async () => {
      try {
        await deleteNodeAction(slug, id);
        configs.current.delete(id);
        setNodes((current) => current.filter((node) => node.id !== id));
        setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
        setSelected(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That step could not be removed.');
      }
    });
  }

  function run() {
    setError('');
    startTransition(async () => {
      try {
        const { runId } = await runWorkflowAction(slug, workflowId);
        router.push(`/w/${slug}/workflows/${workflowId}/runs/${runId}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That workflow could not be started.');
      }
    });
  }

  const palette = useMemo(() => {
    const groups = new Map<NodeCategory, { type: string; label: string; description: string }[]>();
    for (const definition of Object.values(NODE_DEFINITIONS)) {
      const list = groups.get(definition.category) ?? [];
      list.push({
        type: definition.type,
        label: definition.label,
        description: definition.description,
      });
      groups.set(definition.category, list);
    }
    return [...groups.entries()];
  }, []);

  const selectedNode = selected ? configs.current.get(selected) : null;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr_300px]">
      {canEdit && (
        <aside className="space-y-6">
          <p className="b88-eyebrow">Add a step</p>
          {palette.map(([category, items]) => (
            <div key={category}>
              <p className="b88-caption">{CATEGORY_LABEL[category]}</p>
              <ul className="mt-2 list-none space-y-2 p-0">
                {items.map((item) => (
                  <li key={item.type}>
                    <button
                      type="button"
                      onClick={() => addStep(item.type)}
                      disabled={pending}
                      title={item.description}
                      className="w-full rounded-md border border-hairline p-3 text-left text-sm transition-opacity hover:opacity-80 disabled:opacity-35"
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="b88-caption">
            {nodes.length} {nodes.length === 1 ? 'STEP' : 'STEPS'} · {edges.length}{' '}
            {edges.length === 1 ? 'CONNECTION' : 'CONNECTIONS'}
          </p>
          {canRun && (
            <Button onClick={run} disabled={pending || nodes.length === 0}>
              {pending ? 'Starting' : 'Run now'}
            </Button>
          )}
        </div>

        {error && <StatusMessage tone="error">{error}</StatusMessage>}

        <div
          className="b88-canvas h-[600px] rounded-lg border border-hairline"
          style={
            {
              // Re-point React Flow's own variables at the design tokens, so the
              // canvas inherits light and dark mode without a second palette.
              '--xy-background-color': 'var(--canvas)',
              '--xy-node-border': '1px solid var(--hairline)',
              '--xy-edge-stroke': 'var(--ink)',
              '--xy-edge-stroke-selected': 'var(--accent-magenta)',
              '--xy-handle-background-color': 'var(--ink)',
              '--xy-handle-border-color': 'var(--canvas)',
            } as React.CSSProperties
          }
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeDragStop={persistPositions}
            onNodeClick={(_event, node) => setSelected(node.id)}
            onPaneClick={() => setSelected(null)}
            onEdgesDelete={(deleted) => {
              for (const edge of deleted) void disconnectAction(slug, edge.id);
            }}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            edgesFocusable={canEdit}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="var(--hairline)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>

      <aside>
        {selectedNode ? (
          <NodeConfigPanel
            key={selectedNode.id}
            slug={slug}
            node={selectedNode}
            canEdit={canEdit}
            onSaved={(updated) => {
              configs.current.set(updated.id, updated);
              setNodes((current) =>
                current.map((node) =>
                  node.id === updated.id
                    ? { ...node, data: { ...node.data, label: updated.name } }
                    : node,
                ),
              );
            }}
            onDelete={() => removeStep(selectedNode.id)}
          />
        ) : (
          <div className="rounded-lg border border-hairline p-6">
            <p className="b88-eyebrow">Step settings</p>
            <p className="b88-body-sm mt-3">Select a step on the canvas to configure it.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

/** A step on the canvas: a stroked card with a labelled port down each side. */
function StepNode({ data, selected }: NodeProps<Node<StepData>>) {
  const definition = getDefinition(data.type);
  if (!definition) {
    return (
      <div className="rounded-lg border border-hairline bg-canvas p-4">
        <Badge tone="coral">Unknown step</Badge>
      </div>
    );
  }

  return (
    <div
      className="min-w-56 rounded-lg bg-canvas p-4"
      style={{ border: selected ? '1px solid var(--ink)' : '1px solid var(--hairline)' }}
    >
      <p className="b88-caption">{CATEGORY_LABEL[definition.category]}</p>
      <p className="mt-1 text-base font-medium">{data.label}</p>

      {definition.inputs.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{ top: 48 + index * 22, width: 10, height: 10 }}
          title={`${port.label}${port.required ? ' (required)' : ''}`}
        />
      ))}
      {definition.outputs.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{ top: 48 + index * 22, width: 10, height: 10 }}
          title={port.label}
        />
      ))}

      <div className="mt-3 flex justify-between gap-4">
        <ul className="list-none space-y-1 p-0">
          {definition.inputs.map((port) => (
            <li key={port.id} className="b88-caption">
              {port.label}
              {port.required ? ' *' : ''}
            </li>
          ))}
        </ul>
        <ul className="list-none space-y-1 p-0 text-right">
          {definition.outputs.map((port) => (
            <li key={port.id} className="b88-caption">
              {port.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

const toFlowNode = (node: CanvasNode): Node<StepData> => ({
  id: node.id,
  type: 'step',
  position: { x: node.positionX, y: node.positionY },
  data: { label: node.name, type: node.type },
});

const toFlowEdge = (edge: CanvasEdge): Edge => ({
  id: edge.id,
  source: edge.sourceNodeId,
  sourceHandle: edge.sourcePort,
  target: edge.targetNodeId,
  targetHandle: edge.targetPort,
});
