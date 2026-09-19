import { z } from 'zod';
import { DEFAULT_IMAGE_SIZE } from '@/lib/ai/image-sizes';
import {
  CATEGORY_LABEL,
  NODE_DEFINITIONS,
  findPort,
  getDefinition,
  isCreatableNodeType,
  nodeSaveConfigIssue,
  parseConfig,
  type NodeType,
} from '@/lib/workflows/definitions';
import { reaches, type GraphEdge } from '@/lib/workflows/graph';
import { checkGraphTypes } from '@/lib/workflows/port-resolution';
import { DEFAULT_VIDEO_OUTPUT_SIZE } from '@/lib/workflows/video-output-presets';

/**
 * Local keys the model uses before the graph has database ids. Confirmed
 * proposals map these onto real node rows in one transaction.
 */
export const workflowNodeKeySchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use a short lowercase key such as idea or images.');

export const proposedWorkflowNodeSchema = z.object({
  key: workflowNodeKeySchema,
  type: z.string().refine((value): value is NodeType => isCreatableNodeType(value), 'That step type is not available for new workflows.'),
  name: z.string().min(1).max(80).optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const proposedWorkflowEdgeSchema = z.object({
  sourceKey: workflowNodeKeySchema,
  sourcePort: z.string().min(1).max(40),
  targetKey: workflowNodeKeySchema,
  targetPort: z.string().min(1).max(40),
}).strict();

const workflowNodeRefSchema = z.string().min(1).max(64);

export const workflowGraphEditSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('add_node'),
    key: workflowNodeKeySchema,
    type: z.string().refine((value): value is NodeType => isCreatableNodeType(value), 'That step type is not available for new workflows.'),
    name: z.string().min(1).max(80).optional(),
    positionX: z.number().optional(),
    positionY: z.number().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  z.object({
    operation: z.literal('update_node'),
    nodeId: z.string().uuid(),
    name: z.string().min(1).max(80).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  }).strict(),
  z.object({
    operation: z.literal('remove_node'),
    nodeId: z.string().uuid(),
  }).strict(),
  z.object({
    operation: z.literal('connect'),
    sourceNodeRef: workflowNodeRefSchema,
    sourcePort: z.string().min(1).max(40),
    targetNodeRef: workflowNodeRefSchema,
    targetPort: z.string().min(1).max(40),
  }).strict(),
  z.object({
    operation: z.literal('disconnect'),
    edgeId: z.string().uuid(),
  }).strict(),
]);

/**
 * Straightens out the shapes a model reaches for instead of the ones this
 * schema names.
 *
 * Every mistake handled here was fatal before it: a capitalised node key, an
 * "addNode" operation, a lowercase step type or an edge written with
 * source/target rather than sourceKey/targetKey all fail the discriminated
 * union outright, and the user reads that as "the AI returned something
 * Bridge88 could not use" for a proposal that was one rename away from valid.
 * Repairing them costs nothing; a repair turn costs a minute of waiting.
 *
 * It only renames — it never invents a field, a step or a connection, so an
 * action that was genuinely wrong still fails validation and is still repaired
 * or reported rather than quietly becoming a different workflow.
 */
export function normalizeAssistantAction(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const action = { ...value };
  if (typeof action.kind === 'string') action.kind = snake(action.kind);

  if (action.kind === 'create_workflow') {
    if (Array.isArray(action.nodes)) action.nodes = action.nodes.map(normalizeNode);
    if (Array.isArray(action.edges)) {
      action.edges = action.edges.map((edge) => {
        if (!isRecord(edge)) return edge;
        return omitUndefined({
          ...edge,
          sourceKey: localKey(pick(edge, ['sourceKey', 'sourceNodeRef', 'sourceNodeId', 'source', 'from'])),
          sourcePort: pick(edge, ['sourcePort', 'sourceHandle', 'fromPort', 'outputPort', 'output']),
          targetKey: localKey(pick(edge, ['targetKey', 'targetNodeRef', 'targetNodeId', 'target', 'to'])),
          targetPort: pick(edge, ['targetPort', 'targetHandle', 'toPort', 'inputPort', 'input']),
          sourceNodeRef: undefined,
          targetNodeRef: undefined,
          source: undefined,
          target: undefined,
        });
      });
    }
  }

  if (action.kind === 'update_workflow' && Array.isArray(action.graphEdits)) {
    action.graphEdits = action.graphEdits.map((edit) => {
      if (!isRecord(edit)) return edit;
      const operation = typeof edit.operation === 'string'
        ? OPERATION_ALIASES[snake(edit.operation)] ?? snake(edit.operation)
        : edit.operation;
      if (operation === 'add_node') {
        const normalized = normalizeNode(edit);
        return isRecord(normalized) ? { ...normalized, operation } : edit;
      }
      if (operation === 'connect') {
        return omitUndefined({
          ...edit,
          operation,
          sourceNodeRef: localKey(pick(edit, ['sourceNodeRef', 'sourceKey', 'sourceNodeId', 'source', 'from'])),
          sourcePort: pick(edit, ['sourcePort', 'sourceHandle', 'fromPort', 'outputPort', 'output']),
          targetNodeRef: localKey(pick(edit, ['targetNodeRef', 'targetKey', 'targetNodeId', 'target', 'to'])),
          targetPort: pick(edit, ['targetPort', 'targetHandle', 'toPort', 'inputPort', 'input']),
          sourceKey: undefined,
          targetKey: undefined,
          source: undefined,
          target: undefined,
        });
      }
      return { ...edit, operation };
    });
  }

  return action;
}

const OPERATION_ALIASES: Record<string, string> = {
  add: 'add_node',
  add_step: 'add_node',
  create_node: 'add_node',
  new_node: 'add_node',
  node: 'add_node',
  update: 'update_node',
  edit_node: 'update_node',
  configure_node: 'update_node',
  remove: 'remove_node',
  delete: 'remove_node',
  delete_node: 'remove_node',
  add_edge: 'connect',
  link: 'connect',
  connect_nodes: 'connect',
  remove_edge: 'disconnect',
  delete_edge: 'disconnect',
  unlink: 'disconnect',
};

function normalizeNode(node: unknown): unknown {
  if (!isRecord(node)) return node;
  const config = pick(node, ['config', 'settings', 'configuration']);
  return omitUndefined({
    ...node,
    key: localKey(pick(node, ['key', 'id', 'ref', 'nodeKey'])),
    type: typeof node.type === 'string' ? snake(node.type).toUpperCase() : node.type,
    config: isRecord(config) ? config : node.config,
    settings: undefined,
    configuration: undefined,
  });
}

/**
 * A local node key, or whatever was there if it cannot be one.
 *
 * A uuid is left alone: connect edits address existing steps by id, and
 * lowercasing hyphens into underscores there would point the edit at nothing.
 */
function localKey(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (UUID.test(value)) return value;
  const key = snake(value).replace(/^[^a-z]+/, '').slice(0, 40);
  return key || value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "addNode", "Add-Node" and "ADD NODE" all become "add_node". */
function snake(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type ProposedWorkflowNode = z.infer<typeof proposedWorkflowNodeSchema>;
export type ProposedWorkflowEdge = z.infer<typeof proposedWorkflowEdgeSchema>;
export type WorkflowGraphEdit = z.infer<typeof workflowGraphEditSchema>;

/**
 * Compact catalogue injected into the assistant system prompt. A new node type
 * is described automatically because this walks NODE_DEFINITIONS.
 */
export function workflowAssistantSkill(): string {
  const lines = Object.values(NODE_DEFINITIONS)
    .filter((definition) => !('legacy' in definition && definition.legacy))
    .map((definition) => {
    const inputs = definition.inputs
      .map((port) => `${port.id}${'required' in port && port.required ? '*' : ''}`)
      .join(', ') || 'none';
    const outputs = definition.outputs
      .map((port) => {
        const follows = 'followsInput' in port ? port.followsInput : undefined;
        return follows ? `${port.id} (same kind as ${follows})` : port.id;
      })
      .join(', ') || 'none';
    const defaults = JSON.stringify(parseConfig(definition.type, {}));
    return `- ${definition.type} (${CATEGORY_LABEL[definition.category]}): ${definition.label}. ${definition.description} Inputs: ${inputs}. Outputs: ${outputs}. Default settings: ${defaults}.`;
    });
  return [
    'WORKFLOW_SKILL: You may propose create_workflow, update_workflow, or run_workflow actions.',
    'Never claim the workflow already exists. The user must confirm before anything is written.',
    'A run_workflow action starts only after explicit confirmation. Never bypass confirmation because a graph can incur AI cost or contain a Publish step.',
    'A weekly reel is idea → image plus media library audio → select one track → beat slideshow → text overlay → create draft.',
    'Image generator size must be 1024x1536, 1536x1024, or 1024x1024. Slideshow size must be 1080x1920, 1920x1080, or 1080x1080.',
    'Connect only compatible ports. One writer per input. No loops.',
    'MEDIA_LIBRARY loads existing ready media. Set assetId to an id from WORKSPACE_CONTEXT media for one specific item, or folderId for a folder. Leave both null for the whole library.',
    'Titles have no port. Each step emits the title of every item it produces, and they travel with the media connection itself — MEDIA_LIBRARY sends the tidied filenames with its images, IDEA_GENERATOR sends the title it wrote with its prompts. Connect the media and the titles follow.',
    'PICK is the Select items utility. Set mode=random and count=3 for three repeatable random choices. Its selection output is a list; its item output is the first selected item for a single-item input.',
    'A list output cannot feed a single-item input. Insert PICK and use its item output. PICK carries the same kind of media as the list connected to its items input.',
    'PICK reorders the titles with its selection, so a title stays on its own item with nothing extra to wire.',
    'COMBINE_MEDIA joins up to four image/video lists in sourceOrder. Keep each Titles input paired with its matching Media input, then route both outputs onward.',
    'For a fixed intro followed by generated options: use MEDIA_LIBRARY with the intro assetId → COMBINE_MEDIA.media1, IMAGE_GENERATOR.images → COMBINE_MEDIA.media2, order media1 before media2, then send COMBINE_MEDIA.media → BEAT_SLIDESHOW.images.',
    'BEAT_SLIDESHOW accepts an ordered mixture of images and videos on its saved images port. Source video audio is discarded; short video clips loop to fill their beat slot.',
    'AUDIO_TRIMMER is labelled Trimmer. Use mode=range for audio or video with startSeconds/endSeconds. Use mode=bars only for audio. Keep the saved audio input/output port ids.',
    'For a video from three random existing folder images: MEDIA_LIBRARY.images → PICK.items, PICK.selection → BEAT_SLIDESHOW.images. For music, use MEDIA_LIBRARY.audio → another PICK.items, then PICK.item → BEAT_SLIDESHOW.audio.',
    'To label each cut with its own title, set TEXT_OVERLAY structure to "titles", "numbered-title" or "opening-titles". The titles are already there; nothing needs connecting for them.',
    'Do not add MUSIC_SELECTOR to new workflows; it is retained only so old saved workflows still run.',
    // The one capability a model cannot infer from the port list, and the one
    // most often asked for: "random themes", "varied topics", "do not repeat".
    // Without this it wires an idea step into a Pick, which takes media and not
    // text, and the whole proposal is rejected for a port that does not exist.
    'IDEA_GENERATOR can pick its own subject: set themeMode "random", leave theme empty, and put one subject per entry in themePool. Each run draws one and skips whatever that step used most recently, so the subject keeps moving on its own.',
    'Use themeMode "random" whenever the user asks for random, varied, rotating or non-repeating subjects, and write 12 to 30 concrete, distinct entries into themePool yourself rather than asking them for the list. themeMode "fixed" is for a workflow that should cover the same subject every run.',
    'There is no way to select one text value at random with a step. PICK selects media, not text, so never wire a text output into PICK.items — a random subject is themeMode "random" on the idea step.',
    'To copy, duplicate or clone an existing workflow, propose create_workflow with the same steps, settings and connections as the source workflow in WORKSPACE_CONTEXT, under a new name, changing only what the user asked to change. Never propose update_workflow for a copy: that edits the original.',
    'Node keys are local labels such as idea, images, library, or track. They are not database ids.',
    'For update_workflow, graphEdits can add, update, remove, connect, or disconnect steps. Existing steps use their workspace ids. New steps use a local key, and later connect edits refer to that key.',
    'Return the ordinary assistant envelope {"reply":string,"action":action|null}.',
    'create_workflow action: {"kind":"create_workflow","summary":string,"name":string,"description":string|null,"scheduleEnabled":boolean,"scheduleWeekdays":number[],"scheduleHour":number,"scheduleMinute":number,"nodes":[{"key":string,"type":nodeType,"name":string,"positionX":number,"positionY":number,"config":object}],"edges":[{"sourceKey":string,"sourcePort":string,"targetKey":string,"targetPort":string}]}.',
    'update_workflow action: {"kind":"update_workflow","summary":string,"workflowId":uuid,"workflowName":string,"name"?:string,"description"?:string|null,"scheduleEnabled"?:boolean,"scheduleWeekdays"?:number[],"scheduleHour"?:number,"scheduleMinute"?:number,"nodeUpdates":[],"graphEdits":[edit]}. An edit is add_node with key,type,name,positionX,positionY,config; update_node with nodeId and full config; remove_node with nodeId; connect with sourceNodeRef,sourcePort,targetNodeRef,targetPort; or disconnect with edgeId.',
    // The prose spec above was not enough on its own: the model kept inventing
    // operation names ("add", "addNode"), capitalising node keys, and dropping
    // required fields, which fails the discriminated union and reaches the user
    // as "the AI returned something Bridge88 could not use". A literal worked
    // example of the most common request fixes that far more reliably than more
    // description does.
    'operation must be exactly one of add_node, update_node, remove_node, connect, disconnect. A node key is lowercase letters, digits and underscores, starting with a letter — "publish" or "yt_publish", never "Publish" or "publish-step".',
    'Worked example — appending a Publish step to an existing workflow and wiring it to the step that currently produces the finished video: {"kind":"update_workflow","summary":"Add a Publish step posting to the connected YouTube channel","workflowId":"<the workflow uuid from WORKSPACE_CONTEXT>","workflowName":"Treehouses","nodeUpdates":[],"graphEdits":[{"operation":"add_node","key":"publish","type":"PUBLISH","name":"Publish to YouTube","positionX":1900,"positionY":-150,"config":{"socialAccountIds":["<a channel id from WORKSPACE_CONTEXT channels>"],"caption":"","mode":"queue","requireApproval":true}},{"operation":"connect","sourceNodeRef":"<uuid of the step whose video output feeds it>","sourcePort":"video","targetNodeRef":"publish","targetPort":"video"}]}.',
    'In a connect edit, sourceNodeRef and targetNodeRef are either the uuid of an existing step or the local key of a step added earlier in the same graphEdits array.',
    // Built from the template rather than written out by hand: an example that
    // drifts from what validateProposedGraph accepts teaches the model to fail.
    `Worked example — a complete create_workflow whose subject changes every run: ${JSON.stringify(exampleCreateWorkflowAction())}.`,
    'run_workflow action: {"kind":"run_workflow","summary":string,"workflowId":uuid,"workflowName":string}.',
    'CREATE_DRAFT and PUBLISH take title, caption, hashtags and firstComment as inputs as well as settings, and a connected input overrides the setting. Wire an IDEA_GENERATOR output into them when the user wants the copy written per run; leave the setting as typed text when the same wording should go out every time. Their mentions and link settings have no inputs and are typed only.',
    'IDEA_GENERATOR always outputs postTitle, caption and hashtags alongside its prompts, so connect those rather than adding additionalOutputs for them. To control how that copy reads, set its titleGuidance, captionGuidance or hashtagsGuidance settings — one instruction each, such as "two sentences, no emoji" — and leave them empty to let the model choose.',
    'IMAGE_GENERATOR takes provider: "default" | "mock" | "openai" | "image-use". Use "mock" when the user is testing workflow structure or asks to avoid generation cost, "image-use" when they want their ChatGPT subscription rather than a per-image API bill (it is also the only one that renders size 1024x1820, a true 9:16 with no crop into vertical video), and leave it "default" for final creative output unless they say otherwise. ANIMATE_IMAGE still takes useMockGeneration:true for the same testing purpose.',
    'Catalogue:',
    ...lines,
  ].join('\n');
}

/**
 * The create_workflow action the prompt shows the model.
 *
 * Generated from the same template the tests validate, so the example in the
 * prompt is always a proposal this code would accept.
 */
function exampleCreateWorkflowAction() {
  const graph = weeklyReelTemplate('architecture', [
    'Brutalist civic buildings in soft light',
    'Warm minimal interiors with oak and linen',
    'Cliffside houses with deep overhangs',
  ]);
  return {
    kind: 'create_workflow',
    summary: `Create "${graph.name}"`,
    name: graph.name,
    description: graph.description,
    scheduleEnabled: false,
    scheduleWeekdays: [],
    scheduleHour: 9,
    scheduleMinute: 0,
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

export function weeklyReelTemplate(theme: string, themePool: string[] = []): {
  name: string;
  description: string;
  nodes: ProposedWorkflowNode[];
  edges: ProposedWorkflowEdge[];
} {
  const trimmed = theme.trim().slice(0, 80) || 'weekly reel';
  const pool = themePool.map((entry) => entry.trim()).filter(Boolean);
  return {
    name: `${trimmed} reel`,
    description: pool.length
      ? `Draws a subject from ${pool.length} topics, generates stills for it, cuts them to a track, labels each cut, and leaves a draft to review.`
      : `Generates stills from “${trimmed}”, cuts them to a track, labels each cut, and leaves a draft to review.`,
    nodes: [
      {
        key: 'idea',
        type: 'IDEA_GENERATOR',
        name: 'Theme ideas',
        positionX: 40,
        positionY: 40,
        config: pool.length
          ? { mode: 'image', themeMode: 'random', theme: '', themePool: pool, count: 8, styleSuffix: '' }
          : { mode: 'image', theme: trimmed, count: 8, styleSuffix: '' },
      },
      {
        key: 'images',
        type: 'IMAGE_GENERATOR',
        name: 'Render scenes',
        positionX: 340,
        positionY: 40,
        config: { size: DEFAULT_IMAGE_SIZE, maxImages: 8 },
      },
      {
        key: 'library',
        type: 'MEDIA_LIBRARY',
        name: 'Media library',
        positionX: 340,
        positionY: 260,
        config: { folderId: null, includeSubfolders: true },
      },
      {
        key: 'track',
        type: 'PICK',
        name: 'Select a track',
        positionX: 560,
        positionY: 260,
        config: { mode: 'random', count: 1, index: 0 },
      },
      {
        key: 'slideshow',
        type: 'BEAT_SLIDESHOW',
        name: 'Cut to the beat',
        positionX: 780,
        positionY: 140,
        config: {
          beatsPerClip: 8,
          size: DEFAULT_VIDEO_OUTPUT_SIZE,
          fps: 30,
          fit: 'cover',
          kenBurns: true,
          visualLeadMs: 0,
          fadeOutSeconds: 1.2,
        },
      },
      {
        key: 'overlay',
        type: 'TEXT_OVERLAY',
        name: 'Label each cut',
        positionX: 1100,
        positionY: 140,
        config: { structure: 'numbered', template: '{index}', font: 'Archivo-Bold', position: 'top', fontSize: 0 },
      },
      {
        key: 'draft',
        type: 'CREATE_DRAFT',
        name: 'Leave a draft',
        positionX: 1420,
        positionY: 140,
        // Left empty on purpose: the copy is wired in from the idea step
        // below, so every run gets its own title, caption and tags rather than
        // the theme repeated verbatim.
        config: { title: '', caption: '', hashtags: '', campaignId: null, socialAccountIds: [] },
      },
    ],
    edges: [
      { sourceKey: 'idea', sourcePort: 'prompts', targetKey: 'images', targetPort: 'prompts' },
      { sourceKey: 'images', sourcePort: 'images', targetKey: 'slideshow', targetPort: 'images' },
      { sourceKey: 'library', sourcePort: 'audio', targetKey: 'track', targetPort: 'items' },
      { sourceKey: 'track', sourcePort: 'item', targetKey: 'slideshow', targetPort: 'audio' },
      { sourceKey: 'slideshow', sourcePort: 'video', targetKey: 'overlay', targetPort: 'video' },
      { sourceKey: 'overlay', sourcePort: 'video', targetKey: 'draft', targetPort: 'video' },
      { sourceKey: 'idea', sourcePort: 'postTitle', targetKey: 'draft', targetPort: 'title' },
      { sourceKey: 'idea', sourcePort: 'caption', targetKey: 'draft', targetPort: 'caption' },
      { sourceKey: 'idea', sourcePort: 'hashtags', targetKey: 'draft', targetPort: 'hashtags' },
    ],
  };
}

export function validateProposedGraph(
  nodes: ProposedWorkflowNode[],
  edges: ProposedWorkflowEdge[],
): { nodes: ProposedWorkflowNode[]; edges: ProposedWorkflowEdge[] } {
  if (nodes.length < 1) throw new Error('A workflow needs at least one step.');
  const keys = new Set<string>();
  const normalised: ProposedWorkflowNode[] = [];
  for (const node of nodes) {
    if (keys.has(node.key)) throw new Error(`Two steps share the key "${node.key}".`);
    keys.add(node.key);
    if (!isCreatableNodeType(node.type)) {
      throw new Error(`"${node.type}" is not a step available for new workflows.`);
    }
    const definition = getDefinition(node.type)!;
    let config: Record<string, unknown>;
    try {
      config = parseConfig(node.type, node.config ?? {}) as Record<string, unknown>;
    } catch {
      throw new Error(`The settings on "${node.name ?? definition.label}" are not valid.`);
    }
    const saveIssue = nodeSaveConfigIssue(node.type, config);
    if (saveIssue) throw new Error(saveIssue.message);
    normalised.push({
      ...node,
      name: node.name?.trim() || definition.label,
      config,
      positionX: node.positionX ?? 40,
      positionY: node.positionY ?? 40,
    });
  }

  const byKey = new Map(normalised.map((node) => [node.key, node]));
  const graphEdges: GraphEdge[] = [];
  for (const edge of edges) {
    const source = byKey.get(edge.sourceKey);
    const target = byKey.get(edge.targetKey);
    if (!source || !target) {
      throw new Error('A connection points at a step that is not in this workflow.');
    }
    if (source.key === target.key) throw new Error('A step cannot connect to itself.');
    const outPort = findPort(source.type, edge.sourcePort, 'outputs');
    const inPort = findPort(target.type, edge.targetPort, 'inputs');
    if (!outPort || !inPort) throw new Error('A connection uses a port that does not exist on that step.');
    graphEdges.push({
      sourceNodeId: source.key,
      sourcePort: edge.sourcePort,
      targetNodeId: target.key,
      targetPort: edge.targetPort,
    });
  }

  for (const edge of graphEdges) {
    const others = graphEdges.filter((item) => item !== edge);
    if (reaches(others, edge.targetNodeId, edge.sourceNodeId)) {
      throw new Error('That connection would create a loop. Workflows must flow one way.');
    }
    const occupied = graphEdges.filter(
      (item) => item.targetNodeId === edge.targetNodeId && item.targetPort === edge.targetPort,
    );
    if (occupied.length > 1) {
      throw new Error(`"${byKey.get(edge.targetNodeId)?.name}" already has something connected to that input.`);
    }
  }

  for (const node of normalised) {
    const definition = getDefinition(node.type)!;
    const missing = definition.inputs.find(
      (port) =>
        port.required
        && !graphEdges.some(
          (edge) => edge.targetNodeId === node.key && edge.targetPort === port.id,
        ),
    );
    if (missing) {
      throw new Error(`"${node.name}" needs a connection to its ${missing.label} input.`);
    }
  }

  // Types last: a generic output only resolves once the graph it reads from is
  // known to be loop-free, single-writer and fully connected.
  const mistyped = checkGraphTypes({
    nodes: normalised.map((node) => ({ id: node.key, type: node.type, name: node.name })),
    edges: graphEdges,
  });
  if (mistyped) throw new Error(mistyped.reason);

  return { nodes: normalised, edges };
}
