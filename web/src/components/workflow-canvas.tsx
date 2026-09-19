'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from 'lucide-react';
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
import { Badge, Field, IconButton, StatusMessage } from '@/bridge88/components';
import {
  CATEGORY_LABEL,
  NODE_DEFINITIONS,
  type NodeCategory,
  type WorkflowAudioOption,
  type WorkflowChannelOption,
  type WorkflowMediaAssetOption,
  type WorkflowMediaCounts,
  type WorkflowMediaFolderOption,
  findPort,
  getDefinition,
  getNodePorts,
} from '@/lib/workflows/definitions';
import {
  mediaLibraryOutputCounts,
  type MediaLibraryOutputCounts,
} from '@/lib/workflows/media-library-outputs';
import { describeConnection } from '@/lib/workflows/connection-label';
import { reaches } from '@/lib/workflows/graph';
import { checkAddedEdge } from '@/lib/workflows/port-resolution';
import {
  addNodeAction,
  connectNodesAction,
  deleteNodeAction,
  disconnectAction,
  saveNodePositionsAction,
} from '@/app/actions/workflows';
import {
  NodeConfigPanel,
  type NodeInputConnection,
} from '@/components/workflow-config-panel';
import { ConnectionConfigPanel } from '@/components/workflow-connection-panel';

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

type StepData = {
  label: string;
  type: string;
  config: unknown;
  outputCounts?: MediaLibraryOutputCounts;
};

type ContextMenuTarget =
  | { kind: 'edge'; id: string; x: number; y: number }
  | { kind: 'node'; id: string; x: number; y: number };

type PortKind = 'source' | 'target';

/**
 * Which ports would accept the connection currently being dragged.
 *
 * Passed by context rather than through node data so that starting a drag does
 * not rewrite every node object and restart React Flow's own drag bookkeeping.
 */
const ConnectingContext = createContext<{
  active: boolean;
  accepts: (nodeId: string, portId: string, kind: PortKind) => boolean;
  isOutputConnected: (nodeId: string, portId: string) => boolean;
  isInputConnected: (nodeId: string, portId: string) => boolean;
}>({
  active: false,
  accepts: () => false,
  isOutputConnected: () => false,
  isInputConnected: () => false,
});

/** True when this deployment mocks media generation whatever a step asks for. */
const MockedProviderContext = createContext(false);

const EDGE_HIT_WIDTH = 24;
const INSPECTOR_MIN_WIDTH = 320;
const INSPECTOR_MAX_WIDTH = 640;
const INSPECTOR_DEFAULT_WIDTH = 380;
const INSPECTOR_WIDTH_KEY = 'bridge88.workflow.inspector-width';
const LIBRARY_COLLAPSED_KEY = 'bridge88.workflow.library-collapsed';

const EDGE_A11Y_HINT =
  'Press Enter or Space to select this connection. Then press Backspace or Delete to remove it, or use the connection settings panel.';

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
  accounts: WorkflowChannelOption[];
  audioAssets: WorkflowAudioOption[];
  mediaAssets: WorkflowMediaAssetOption[];
  mediaFolders: WorkflowMediaFolderOption[];
  mediaCounts: WorkflowMediaCounts;
  mediaProviderMocked: boolean;
  canEdit: boolean;
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
  accounts,
  audioAssets,
  mediaAssets,
  mediaFolders,
  mediaCounts,
  mediaProviderMocked,
  canEdit,
}: {
  slug: string;
  workflowId: string;
  initialNodes: CanvasNode[];
  initialEdges: CanvasEdge[];
  accounts: WorkflowChannelOption[];
  audioAssets: WorkflowAudioOption[];
  mediaAssets: WorkflowMediaAssetOption[];
  mediaFolders: WorkflowMediaFolderOption[];
  mediaCounts: WorkflowMediaCounts;
  mediaProviderMocked: boolean;
  canEdit: boolean;
}) {
  const [error, setError] = useState('');
  // One menu at a time: opening either kind closes the other by construction.
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const [connectStart, setConnectStart] = useState<{
    nodeId: string;
    handleId: string;
    handleType: PortKind;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const configs = useRef(new Map(initialNodes.map((n) => [n.id, n])));

  // Layout preferences belong to the editor rather than a workflow, so one
  // resize/collapse carries to the next workflow without changing shared data.
  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    if (Number.isFinite(savedWidth)) {
      setInspectorWidth(clampInspectorWidth(savedWidth));
    }
    setLibraryCollapsed(window.localStorage.getItem(LIBRARY_COLLAPSED_KEY) === 'true');
  }, []);

  const setLibraryVisibility = useCallback((collapsed: boolean) => {
    setLibraryCollapsed(collapsed);
    window.localStorage.setItem(LIBRARY_COLLAPSED_KEY, String(collapsed));
  }, []);

  const commitInspectorWidth = useCallback((width: number) => {
    const next = clampInspectorWidth(width);
    setInspectorWidth(next);
    window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(next));
  }, []);

  const beginInspectorResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      // The handle is on the left of the rail: moving left makes it wider.
      setInspectorWidth(clampInspectorWidth(startWidth + startX - moveEvent.clientX));
    };
    const finish = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
      const finalWidth = clampInspectorWidth(startWidth + startX - upEvent.clientX);
      commitInspectorWidth(finalWidth);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
  }, [commitInspectorWidth, inspectorWidth]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StepData>>(
    initialNodes.map((node) => toFlowNode(node, mediaFolders, mediaCounts, mediaAssets)),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initialEdges.map((edge) => toFlowEdge(edge, configs.current, canEdit)),
  );

  /**
   * Selection is read back off React Flow rather than mirrored in local state.
   * A second copy drifts: the pane click that clears React Flow's selection did
   * not always clear ours, so the rail needed a second click to close.
   * The rail is for one element, so a multi-select shows nothing.
   */
  const selectedNodeId = useMemo(() => {
    const chosen = nodes.filter((node) => node.selected);
    return chosen.length === 1 && !edges.some((edge) => edge.selected) ? chosen[0].id : null;
  }, [nodes, edges]);

  const selectedEdgeId = useMemo(() => {
    const chosen = edges.filter((edge) => edge.selected);
    return chosen.length === 1 && !nodes.some((node) => node.selected) ? chosen[0].id : null;
  }, [nodes, edges]);

  /** Right-click does not select on its own, so the rail is pointed by hand. */
  const selectOnly = useCallback(
    (kind: 'node' | 'edge', id: string) => {
      setNodes((current) =>
        current.map((node) => ({ ...node, selected: kind === 'node' && node.id === id })),
      );
      setEdges((current) =>
        current.map((edge) => ({ ...edge, selected: kind === 'edge' && edge.id === id })),
      );
    },
    [setNodes, setEdges],
  );

  /**
   * Opens the canvas with one step already selected, for `?node=<id>` links.
   *
   * A run that failed on one step should be one click away from that step's
   * settings — otherwise the person reading the failure has to find the node
   * on the board themselves, which on a wide graph means hunting.
   *
   * Runs once per requested id rather than on every render: the rail is a
   * normal selection afterwards, so re-asserting it would fight the user the
   * moment they clicked something else.
   */
  const focusedNodeId = useSearchParams().get('node');
  const focusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusedNodeId || focusedRef.current === focusedNodeId) return;
    if (!nodes.some((node) => node.id === focusedNodeId)) return;
    focusedRef.current = focusedNodeId;
    selectOnly('node', focusedNodeId);
  }, [focusedNodeId, nodes, selectOnly]);

  const nodeLookup = useMemo(() => {
    const lookup = new Map<string, { name: string; type: string }>();
    for (const node of nodes) {
      const config = configs.current.get(node.id);
      lookup.set(node.id, { name: config?.name ?? node.data.label, type: node.data.type });
    }
    return lookup;
  }, [nodes]);

  const flowEdges = useMemo(
    () =>
      edges.map((edge) => {
        const canvas = flowEdgeToCanvas(edge);
        const { ariaLabel } = describeConnection(canvas, nodeLookup);
        return {
          ...edge,
          ariaLabel,
          deletable: canEdit,
          interactionWidth: EDGE_HIT_WIDTH,
        };
      }),
    [edges, nodeLookup, canEdit],
  );

  const selectedCanvasEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    const edge = edges.find((item) => item.id === selectedEdgeId);
    return edge ? flowEdgeToCanvas(edge) : null;
  }, [selectedEdgeId, edges]);

  const selectedConnectionDescription = selectedCanvasEdge
    ? describeConnection(selectedCanvasEdge, nodeLookup)
    : null;

  const connectionAllowed = useCallback(
    (sourceId: string, sourcePort: string, targetId: string, targetPort: string) => {
      if (sourceId === targetId) return false;
      const source = configs.current.get(sourceId);
      const target = configs.current.get(targetId);
      if (!source || !target) return false;
      const output = getNodePorts(source.type, source.config, 'outputs').find((port) => port.id === sourcePort);
      const input = getNodePorts(target.type, target.config, 'inputs').find((port) => port.id === targetPort);
      if (!output || !input) return false;
      if (edges.some((edge) => edge.target === targetId && edge.targetHandle === targetPort)) return false;
      const graphEdges = edges.map(flowEdgeToCanvas);
      if (reaches(graphEdges, targetId, sourceId)) return false;
      const graphNodes = [...configs.current.entries()].map(([id, config]) => ({
        id,
        type: config.type,
        name: config.name,
        config: config.config,
      }));
      return !checkAddedEdge(
        { nodes: graphNodes, edges: graphEdges },
        { sourceNodeId: sourceId, sourcePort, targetNodeId: targetId, targetPort },
      );
    },
    [edges],
  );

  /** Label and action for whichever element was right-clicked. */
  const contextMenuAction = useMemo(() => {
    if (!contextMenu) return null;
    if (contextMenu.kind === 'edge') {
      const edge = edges.find((item) => item.id === contextMenu.id);
      if (!edge) return null;
      return {
        menuLabel: 'Connection actions',
        itemLabel: 'Remove connection',
        target: describeConnection(flowEdgeToCanvas(edge), nodeLookup).title,
      };
    }
    const node = nodeLookup.get(contextMenu.id);
    if (!node) return null;
    return { menuLabel: 'Step actions', itemLabel: 'Remove step', target: node.name };
  }, [contextMenu, edges, nodeLookup]);

  /**
   * Refuses an incompatible drop before the pointer is released, using the same
   * function the server action re-checks with. The client copy is a courtesy;
   * the server one is the control.
   */
  const connecting = useMemo(() => {
    if (!connectStart) return { active: false, accepts: () => false };

    const originNode = configs.current.get(connectStart.nodeId);
    const fromSource = connectStart.handleType === 'source';
    const originPort = fromSource
      ? (originNode ? getNodePorts(originNode.type, originNode.config, 'outputs') : []).find((port) => port.id === connectStart.handleId)
      : (originNode ? getNodePorts(originNode.type, originNode.config, 'inputs') : []).find((port) => port.id === connectStart.handleId);

    return {
      active: true,
      accepts: (nodeId: string, portId: string, kind: PortKind) => {
        if (!originPort || nodeId === connectStart.nodeId) return false;
        // A drag that started on an output can only land on an input.
        if (kind === connectStart.handleType) return false;

        const candidateNode = configs.current.get(nodeId);
        const port = (candidateNode ? getNodePorts(candidateNode.type, candidateNode.config, kind === 'target' ? 'inputs' : 'outputs') : []).find(
          (candidate) => candidate.id === portId,
        );
        if (!port) return false;

        return fromSource
          ? connectionAllowed(connectStart.nodeId, connectStart.handleId, nodeId, portId)
          : connectionAllowed(nodeId, portId, connectStart.nodeId, connectStart.handleId);
      },
    };
  }, [connectStart, connectionAllowed]);

  const connectionUi = useMemo(
    () => ({
      ...connecting,
      isOutputConnected: (nodeId: string, portId: string) =>
        edges.some((edge) => edge.source === nodeId && edge.sourceHandle === portId),
      isInputConnected: (nodeId: string, portId: string) =>
        edges.some((edge) => edge.target === nodeId && edge.targetHandle === portId),
    }),
    [connecting, edges],
  );

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.sourceHandle || !connection.target || !connection.targetHandle) {
      return false;
    }
    return connectionAllowed(
      connection.source,
      connection.sourceHandle,
      connection.target,
      connection.targetHandle,
    );
  }, [connectionAllowed]);

  const removeConnection = useCallback(
    async (edgeId: string): Promise<boolean> => {
      if (!canEdit) return false;
      try {
        await disconnectAction(slug, edgeId);
        // Dropping it from the list also clears the derived selection.
        setEdges((current) => current.filter((edge) => edge.id !== edgeId));
        setContextMenu((current) => (current?.id === edgeId ? null : current));
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That connection could not be removed.');
        return false;
      }
    },
    [canEdit, slug, setEdges],
  );

  const requestRemoveConnection = useCallback(
    (edgeId: string) => {
      setError('');
      startTransition(async () => {
        await removeConnection(edgeId);
      });
    },
    [removeConnection],
  );

  const onBeforeDelete = useCallback(
    async ({ nodes: nodesToDelete, edges: edgesToDelete }: { nodes: Node[]; edges: Edge[] }) => {
      if (!canEdit) return false;
      setError('');
      const nodeIds = new Set(nodesToDelete.map((node) => node.id));
      try {
        for (const node of nodesToDelete) {
          await deleteNodeAction(slug, node.id);
          configs.current.delete(node.id);
        }
        setNodes((current) => current.filter((node) => !nodeIds.has(node.id)));
        setEdges((current) =>
          current.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
        );
        for (const edge of edgesToDelete) {
          if (!nodeIds.has(edge.source) && !nodeIds.has(edge.target)) {
            await removeConnection(edge.id);
          }
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The selected items could not be removed.');
      }
      return false;
    },
    [canEdit, removeConnection, setEdges, setNodes, slug],
  );

  /**
   * Draws the connection immediately, then confirms it.
   *
   * The edge used to appear only once the save came back, so dropping a
   * connection did nothing visible for the length of a round trip and people
   * reasonably concluded it had not worked. It is drawn at once now, green and
   * travelling, and settles into an ordinary edge when the server answers — or
   * disappears again, with the reason, if the server refuses it.
   *
   * The provisional edge carries a temporary id of its own. Replacing it by id
   * rather than clearing and re-adding means a second connection drawn while
   * the first is still saving is untouched by the first one landing.
   */
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canEdit) return;
      setError('');

      const candidate: CanvasEdge = {
        id: `pending:${connection.source}:${connection.sourceHandle}->${connection.target}:${connection.targetHandle}`,
        sourceNodeId: connection.source!,
        sourcePort: connection.sourceHandle!,
        targetNodeId: connection.target!,
        targetPort: connection.targetHandle!,
      };
      setEdges((current) => addEdge(
        { ...toFlowEdge(candidate, configs.current, canEdit), className: 'b88-edge-pending', deletable: false },
        current,
      ));

      startTransition(async () => {
        try {
          const edge = await connectNodesAction(slug, workflowId, {
            sourceNodeId: connection.source!,
            sourcePort: connection.sourceHandle!,
            targetNodeId: connection.target!,
            targetPort: connection.targetHandle!,
          });
          setEdges((current) => [
            ...current.filter((existing) => existing.id !== candidate.id),
            toFlowEdge({ ...candidate, id: edge.id }, configs.current, canEdit),
          ]);
        } catch (cause) {
          setEdges((current) => current.filter((existing) => existing.id !== candidate.id));
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
        const created = await addNodeAction(slug, workflowId, {
          type,
          positionX: 120 + (nodes.length % 4) * 300,
          positionY: 120 + Math.floor(nodes.length / 4) * 220,
        });
        configs.current.set(created.id, created as unknown as CanvasNode);
        setNodes((current) => [
          ...current,
          toFlowNode(created as unknown as CanvasNode, mediaFolders, mediaCounts, mediaAssets),
        ]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That step could not be added.');
      }
    });
  }

  function removeStep(id: string) {
    setError('');
    startTransition(async () => {
      try {
        await deleteNodeAction(slug, id);
        configs.current.delete(id);
        setNodes((current) => current.filter((node) => node.id !== id));
        setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
        setContextMenu((current) => (current?.id === id ? null : current));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That step could not be removed.');
      }
    });
  }

  const palette = useMemo(() => {
    const groups = new Map<NodeCategory, { type: string; label: string; description: string }[]>();
    const query = paletteQuery.trim().toLocaleLowerCase();
    for (const definition of Object.values(NODE_DEFINITIONS)) {
      if ('legacy' in definition && definition.legacy) continue;
      if (
        query &&
        !`${definition.label} ${definition.description}`.toLocaleLowerCase().includes(query)
      ) {
        continue;
      }
      const list = groups.get(definition.category) ?? [];
      list.push({
        type: definition.type,
        label: definition.label,
        description: definition.description,
      });
      groups.set(definition.category, list);
    }
    return [...groups.entries()];
  }, [paletteQuery]);

  const selectedNode = selectedNodeId ? configs.current.get(selectedNodeId) : null;

  /**
   * What feeds the selected step's inputs, so its settings panel can say which
   * of them a run fills in rather than leaving the typed value looking live.
   */
  const selectedConnections = useMemo<NodeInputConnection[]>(() => {
    if (!selectedNodeId) return [];
    return edges
      .filter((edge) => edge.target === selectedNodeId && edge.targetHandle)
      .map((edge) => {
        const { source } = describeConnection(flowEdgeToCanvas(edge), nodeLookup);
        const port = findPort(source.nodeType, source.portId, 'outputs');
        return {
          portId: edge.targetHandle as string,
          edgeId: edge.id,
          sourceLabel: `${source.nodeName} · ${port?.label ?? source.portId}`,
        };
      });
  }, [edges, selectedNodeId, nodeLookup]);
  const inspector = selectedCanvasEdge && selectedConnectionDescription
    ? 'connection'
    : selectedNode
      ? 'step'
      : null;

  return (
    <div
      className="b88-workflow-editor"
      data-can-edit={canEdit || undefined}
      data-library-collapsed={libraryCollapsed || undefined}
      data-has-inspector={Boolean(inspector) || undefined}
      style={{
        '--workflow-library-width': libraryCollapsed ? '56px' : '220px',
        '--workflow-inspector-width': `${inspectorWidth}px`,
      } as CSSProperties}
    >
      {canEdit && (
        <aside className="b88-workflow-library min-w-0">
          {/* Header and search sit outside the scrolling list: collapsing the
              library is the way out of it, and a control that scrolls away is
              not there when it is wanted. */}
          <div className="b88-workflow-library-head">
            <div className={`flex items-center ${libraryCollapsed ? 'justify-center' : 'justify-between'} gap-2`}>
              {!libraryCollapsed && <p className="b88-eyebrow">Step library</p>}
              <IconButton
                icon={libraryCollapsed ? PanelLeftOpen : PanelLeftClose}
                label={libraryCollapsed ? 'Open step library' : 'Collapse step library'}
                aria-expanded={!libraryCollapsed}
                onClick={() => setLibraryVisibility(!libraryCollapsed)}
              />
            </div>
            {!libraryCollapsed && (
              <div className="relative mt-4">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                  size={16}
                  strokeWidth={1.75}
                />
                <Field
                  label="Find a step"
                  labelHidden
                  value={paletteQuery}
                  placeholder="Find a step"
                  className="pl-9"
                  onChange={(event) => setPaletteQuery(event.target.value)}
                />
              </div>
            )}
          </div>
          {!libraryCollapsed && (
            <div className="b88-workflow-library-list">
              <div className="space-y-2">
                {palette.map(([category, items]) => (
                  <details key={category} open className="group border-b border-hairline pb-2">
                    <summary className="b88-caption flex cursor-pointer list-none items-center justify-between gap-2 py-2">
                      {CATEGORY_LABEL[category]}
                      <ChevronRight
                        size={15}
                        strokeWidth={1.75}
                        className="transition-transform group-open:rotate-90"
                        aria-hidden="true"
                      />
                    </summary>
                    <ul className="list-none space-y-1 p-0">
                      {items.map((item) => (
                        <li key={item.type}>
                          <button
                            type="button"
                            onClick={() => addStep(item.type)}
                            disabled={pending}
                            title={item.description}
                            className="w-full rounded-md border border-hairline px-3 py-2 text-left transition-opacity hover:opacity-80 disabled:opacity-35"
                          >
                            <span className="block text-sm font-[480]">{item.label}</span>
                            <span className="mt-0.5 block text-xs leading-snug">{item.description}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
                {palette.length === 0 && (
                  <p className="text-sm">No steps match “{paletteQuery}”.</p>
                )}
              </div>
            </div>
          )}
        </aside>
      )}

      <div className="min-w-0 space-y-4">
        <p className="b88-caption">
          {nodes.length} {nodes.length === 1 ? 'STEP' : 'STEPS'} · {edges.length}{' '}
          {edges.length === 1 ? 'CONNECTION' : 'CONNECTIONS'}
        </p>

        {error && <StatusMessage tone="error">{error}</StatusMessage>}

        <div
          className="b88-canvas h-[clamp(560px,72vh,820px)] rounded-lg border border-hairline"
          style={
            {
              '--xy-background-color': 'var(--canvas)',
              '--xy-node-border': '1px solid var(--hairline)',
              '--xy-edge-stroke': 'var(--ink)',
              '--xy-edge-stroke-selected': 'var(--accent-magenta)',
              '--xy-handle-background-color': 'var(--ink)',
              '--xy-handle-border-color': 'var(--canvas)',
            } as React.CSSProperties
          }
        >
          <ConnectingContext.Provider value={connectionUi}>
          <MockedProviderContext.Provider value={mediaProviderMocked}>
          <ReactFlow
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={(_event, params) => {
              if (!params.nodeId || !params.handleId || !params.handleType) return;
              setContextMenu(null);
              setConnectStart({
                nodeId: params.nodeId,
                handleId: params.handleId,
                handleType: params.handleType,
              });
            }}
            onConnectEnd={() => setConnectStart(null)}
            // Wider than the 20px default so a drop near a port still lands.
            connectionRadius={44}
            isValidConnection={isValidConnection}
            onNodeDragStop={persistPositions}
            onNodeClick={() => setContextMenu(null)}
            onEdgeClick={() => setContextMenu(null)}
            onNodeContextMenu={(event, node) => {
              if (!canEdit) return;
              event.preventDefault();
              selectOnly('node', node.id);
              setContextMenu({ kind: 'node', id: node.id, x: event.clientX, y: event.clientY });
            }}
            onEdgeContextMenu={(event, edge) => {
              if (!canEdit) return;
              event.preventDefault();
              selectOnly('edge', edge.id);
              setContextMenu({ kind: 'edge', id: edge.id, x: event.clientX, y: event.clientY });
            }}
            onPaneClick={() => setContextMenu(null)}
            onPaneContextMenu={() => setContextMenu(null)}
            onMoveStart={() => setContextMenu(null)}
            /*
              Dragging a step must not open its settings.

              selectNodesOnDrag is the prop that does it: left at its default,
              XYDrag selects the node the moment a drag begins, so picking a
              step up to move it swung the settings rail open and reflowed the
              canvas mid-drag. Turned off, React Flow selects from the DOM
              click handler instead — and a drag never produces a click.

              The two distances then split gestures cleanly in two. d3 emits a
              click only when the pointer travelled no further than
              nodeClickDistance, and a drag begins only once it travels further
              than nodeDragThreshold. Equal values make those complementary
              rather than merely similar: every gesture is exactly one of the
              two, with no dead zone and nothing that both moves and selects.
              3px absorbs the hand jitter in a trackpad click.
            */
            selectNodesOnDrag={false}
            nodeClickDistance={3}
            nodeDragThreshold={3}
            /*
              One step at a time. React Flow ships with two multi-select
              gestures — hold Cmd/Ctrl and click, or hold Shift and drag a
              marquee — and this canvas has nowhere to put the result: the
              settings rail edits exactly one element and renders nothing for a
              multi-selection, so every one of those gestures ends in a blank
              panel and no way to tell why. Nulling both key codes removes the
              gestures rather than leaving them to be discovered by accident.
            */
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            onBeforeDelete={onBeforeDelete}
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
            elementsSelectable
            elevateEdgesOnSelect
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            nodesFocusable
            edgesFocusable={canEdit}
            ariaLabelConfig={{
              'edge.a11yDescription.default': EDGE_A11Y_HINT,
            }}
            // React Flow defaults to a 0.5 minimum. At that scale a normal
            // nine-step workflow is wider than this canvas, so Fit View leaves
            // its first and last nodes outside the viewport. Larger workflows
            // need to be able to zoom farther out before the user chooses
            // where to focus.
            minZoom={0.2}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} color="var(--hairline)" />
            <Controls showInteractive={false} />
          </ReactFlow>
          </MockedProviderContext.Provider>
          </ConnectingContext.Provider>
        </div>
      </div>

      {inspector && (
      <aside className="b88-workflow-inspector relative min-w-0">
        <div
          role="separator"
          aria-label="Resize settings panel"
          aria-orientation="vertical"
          aria-valuemin={INSPECTOR_MIN_WIDTH}
          aria-valuemax={INSPECTOR_MAX_WIDTH}
          aria-valuenow={inspectorWidth}
          tabIndex={0}
          className="b88-workflow-resizer"
          onPointerDown={beginInspectorResize}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            commitInspectorWidth(
              inspectorWidth + (event.key === 'ArrowLeft' ? 24 : -24),
            );
          }}
        >
          <span className="sr-only">Use left and right arrows to resize</span>
        </div>
        {selectedCanvasEdge && selectedConnectionDescription ? (
          <ConnectionConfigPanel
            key={selectedCanvasEdge.id}
            edge={selectedCanvasEdge}
            description={selectedConnectionDescription}
            canEdit={canEdit}
            pending={pending}
            onDelete={() => requestRemoveConnection(selectedCanvasEdge.id)}
          />
        ) : selectedNode ? (
          <NodeConfigPanel
            key={selectedNode.id}
            slug={slug}
            node={selectedNode}
            accounts={accounts}
            audioAssets={audioAssets}
            mediaAssets={mediaAssets}
            mediaFolders={mediaFolders}
            connections={selectedConnections}
            canEdit={canEdit}
            onDisconnect={removeConnection}
            onSaved={(updated) => {
              configs.current.set(updated.id, updated);
              // Rebuilt through toFlowNode rather than patched field by field.
              // Patching label and outputCounts left data.config holding the
              // pre-save values, and the ports a step draws are derived from
              // that config — so adding an Idea generator output, or repointing
              // a Media library, only showed up after a page reload. Position
              // and selection stay as React Flow currently has them.
              setNodes((current) =>
                current.map((node) =>
                  node.id === updated.id
                    ? {
                        ...node,
                        data: toFlowNode(updated, mediaFolders, mediaCounts, mediaAssets).data,
                      }
                    : node,
                ),
              );
              // Edge descriptions name their endpoints and ports, so a rename
              // or a re-typed port leaves them stale too.
              setEdges((current) =>
                current.map((edge) => ({
                  ...edge,
                  ...toFlowEdge(flowEdgeToCanvas(edge), configs.current, canEdit),
                })),
              );
            }}
            onDelete={() => removeStep(selectedNode.id)}
          />
        ) : null}
      </aside>
      )}

      {contextMenu && contextMenuAction && canEdit && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          menuLabel={contextMenuAction.menuLabel}
          itemLabel={contextMenuAction.itemLabel}
          target={contextMenuAction.target}
          pending={pending}
          onRemove={() =>
            contextMenu.kind === 'edge'
              ? requestRemoveConnection(contextMenu.id)
              : removeStep(contextMenu.id)
          }
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

/** Right-click actions for a step or a connection. */
function CanvasContextMenu({
  x,
  y,
  menuLabel,
  itemLabel,
  target,
  pending,
  onRemove,
  onClose,
}: {
  x: number;
  y: number;
  menuLabel: string;
  itemLabel: string;
  target: string;
  pending: boolean;
  onRemove: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const style = useMemo((): CSSProperties => {
    const viewportPadding = 8;
    // Sized to its one label rather than a fixed panel width; clamped against
    // the widest label the menu can hold so it never opens off-screen.
    const maxWidth = 200;
    const left = Math.min(x, window.innerWidth - maxWidth - viewportPadding);
    const top = Math.min(y, window.innerHeight - 56 - viewportPadding);
    return { position: 'fixed', left, top, minWidth: 152, maxWidth, zIndex: 120 };
  }, [x, y]);

  useEffect(() => {
    const menu = menuRef.current;
    menu?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!menu?.contains(event.target as globalThis.Node)) onCloseRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={menuLabel}
      tabIndex={-1}
      className="b88-dropdown-listbox"
      style={style}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={pending}
        aria-label={`${itemLabel}: ${target}`}
        className="b88-dropdown-option w-full border-0 bg-transparent text-left"
        // The kit marks the hovered row with data-active rather than :hover, so
        // pointer and keyboard land on the same one highlighted row.
        data-active={hovered || undefined}
        onPointerMove={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={() => {
          onRemove();
          onClose();
        }}
      >
        <span className="b88-dropdown-option-label">{itemLabel}</span>
      </button>
    </div>,
    document.body,
  );
}

/** The steps that carry a switch to swap the paid model for stand-in media. */
const MOCKABLE_STEPS = new Set(['IMAGE_GENERATOR', 'ANIMATE_IMAGE']);

/**
 * The text a step will use for an input it has no connection for.
 *
 * Inputs that can be answered from the settings share the port's id with the
 * setting's key — title, caption, template — so a non-empty string under that
 * key is the fixed value this run will send.
 */
function typedInput(config: unknown, portId: string): string | null {
  if (typeof config !== 'object' || config === null) return null;
  const value = (config as Record<string, unknown>)[portId];
  if (typeof value !== 'string' || value.trim() === '') return null;
  return value.trim();
}

/** Both spellings: the step-level provider, and the flag it replaced. */
const mockConfigured = (config: unknown) => {
  if (typeof config !== 'object' || config === null) return false;
  const { provider, useMockGeneration } = config as {
    provider?: unknown;
    useMockGeneration?: unknown;
  };
  if (provider === 'mock') return true;
  return provider === undefined || provider === 'default' ? useMockGeneration === true : false;
};

/** A step on the canvas: a stroked card with a labelled port down each side. */
function StepNode({ id, data, selected }: NodeProps<Node<StepData>>) {
  const definition = getDefinition(data.type);
  const connecting = useContext(ConnectingContext);
  const providerMocked = useContext(MockedProviderContext);

  /** During a drag, mark each port as a candidate or not so CSS can show it. */
  const compatibility = (portId: string, kind: PortKind) =>
    connecting.active ? String(connecting.accepts(id, portId, kind)) : undefined;

  if (!definition) {
    return (
      <div className="rounded-lg border border-hairline bg-canvas p-4">
        <Badge tone="coral">Unknown step</Badge>
      </div>
    );
  }

  const mocked =
    MOCKABLE_STEPS.has(data.type) && (providerMocked || mockConfigured(data.config));
  const nodeOutputs = getNodePorts(data.type, data.config, 'outputs');
  const nodeInputs = getNodePorts(data.type, data.config, 'inputs');
  const outputs = data.type === 'MEDIA_LIBRARY' && data.outputCounts
    ? nodeOutputs.filter((port) => {
        const count = data.outputCounts?.[port.id as keyof MediaLibraryOutputCounts] ?? 0;
        return count > 0 || connecting.isOutputConnected(id, port.id);
      })
    : nodeOutputs;

  return (
    <div
      className="w-[280px] rounded-lg bg-canvas p-4"
      style={{ border: selected ? '1px solid var(--ink)' : '1px solid var(--hairline)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="b88-caption">{CATEGORY_LABEL[definition.category]}</p>
        {mocked && (
          <Badge tone="lilac">
            <span
              title={
                providerMocked
                  ? 'This deployment has media generation mocked, so this step produces stand-ins.'
                  : 'This step produces stand-in media instead of calling the paid model.'
              }
            >
              Mock
            </span>
          </Badge>
        )}
      </div>
      <p className="mt-1 break-words text-base font-[540] leading-snug">{data.label}</p>

      {/* The dots on each edge already say which side is which, so the columns
          carry no headings — two extra words per card, nine cards to a board. */}
      <div className="mt-4 grid grid-cols-2 gap-5 border-t border-hairline pt-3">
        <div className="min-w-0">
          <ul className="list-none space-y-1.5 p-0">
          {nodeInputs.map((port) => {
            // An input with no wire and a value typed into the matching setting
            // is answered from the settings every run. Saying so here is the
            // difference between a step that looks unfinished and one that is
            // deliberately fixed.
            const connected = connecting.isInputConnected(id, port.id);
            const typed = !connected && typedInput(data.config, port.id);
            return (
            <li
              key={port.id}
              className="b88-caption relative flex min-h-6 min-w-0 items-center gap-1 leading-tight"
              title={typed ? `${port.label}: fixed to “${typed}”` : port.label}
            >
              <Handle
                id={port.id}
                type="target"
                position={Position.Left}
                style={{ left: -16 }}
                data-compatible={compatibility(port.id, 'target')}
                data-connected={connected || undefined}
                aria-label={
                  `${port.label}${port.required ? ', required' : ''} input` +
                  (typed ? `, set in settings to ${typed}` : '')
                }
              />
              <span className="min-w-0 break-words">
                {port.label}
                {port.required ? ' *' : ''}
              </span>
              {typed && (
                <span className="shrink-0 rounded-sm border border-hairline px-1 py-0.5 text-[9px]">
                  Fixed
                </span>
              )}
            </li>
            );
          })}
          </ul>
        </div>
        <div className="min-w-0 text-right">
          <ul className="list-none space-y-1.5 p-0">
          {outputs.map((port) => {
            const count = data.outputCounts?.[port.id as keyof MediaLibraryOutputCounts];
            const connected = connecting.isOutputConnected(id, port.id);
            return (
            <li
              key={port.id}
              className="b88-caption relative flex min-h-6 min-w-0 items-center justify-end leading-tight"
              title={port.label}
            >
              <span className="min-w-0 break-words">
                {port.label}{typeof count === 'number' ? ` · ${count}` : ''}
              </span>
              <Handle
                id={port.id}
                type="source"
                position={Position.Right}
                style={{ right: -16 }}
                data-compatible={compatibility(port.id, 'source')}
                data-connected={connected || undefined}
                aria-label={`${port.label} output`}
              />
            </li>
            );
          })}
          {outputs.length === 0 && <li className="b88-caption">No ready media</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

function clampInspectorWidth(width: number): number {
  return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(width)));
}

const toFlowNode = (
  node: CanvasNode,
  mediaFolders: WorkflowMediaFolderOption[],
  mediaCounts: WorkflowMediaCounts,
  mediaAssets: WorkflowMediaAssetOption[],
): Node<StepData> => ({
  id: node.id,
  type: 'step',
  position: { x: node.positionX, y: node.positionY },
  data: {
    label: node.name,
    type: node.type,
    config: node.config,
    outputCounts:
      node.type === 'MEDIA_LIBRARY'
        ? mediaLibraryOutputCounts(node.config, mediaFolders, mediaCounts, mediaAssets)
        : undefined,
  },
});

const flowEdgeToCanvas = (edge: Edge): CanvasEdge => ({
  id: edge.id,
  sourceNodeId: edge.source,
  sourcePort: edge.sourceHandle ?? '',
  targetNodeId: edge.target,
  targetPort: edge.targetHandle ?? '',
});

const toFlowEdge = (
  edge: CanvasEdge,
  nodes: Map<string, CanvasNode>,
  canEdit: boolean,
): Edge => {
  const lookup = new Map(
    [...nodes.entries()].map(([id, node]) => [id, { name: node.name, type: node.type }]),
  );
  const { ariaLabel } = describeConnection(edge, lookup);
  return {
    id: edge.id,
    source: edge.sourceNodeId,
    sourceHandle: edge.sourcePort,
    target: edge.targetNodeId,
    targetHandle: edge.targetPort,
    ariaLabel,
    deletable: canEdit,
    interactionWidth: EDGE_HIT_WIDTH,
  };
};
