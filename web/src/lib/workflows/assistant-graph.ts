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
    'MEDIA_LIBRARY.imageTitles is labelled Titles: the tidied filename of each image, in the same order as images. Use it when the overlay should show those titles.',
    'PICK is the Select items utility. Set mode=random and count=3 for three repeatable random choices. Its selection output is a list; its item output is the first selected item for a single-item input.',
    'A list output cannot feed a single-item input. Insert PICK and use its item output. PICK carries the same kind of media as the list connected to its items input.',
    'If PICK sits between a media list and its titles, route the titles through PICK.labels as well, or every title lands on the wrong item. MEDIA_LIBRARY.imageTitles → PICK.labels, PICK.labels → BEAT_SLIDESHOW.titles.',
    'COMBINE_MEDIA joins up to four image/video lists in sourceOrder. Keep each Titles input paired with its matching Media input, then route both outputs onward.',
    'For a fixed intro followed by generated options: use MEDIA_LIBRARY with the intro assetId → COMBINE_MEDIA.media1, IMAGE_GENERATOR.images → COMBINE_MEDIA.media2, order media1 before media2, then send COMBINE_MEDIA.media → BEAT_SLIDESHOW.images.',
    'BEAT_SLIDESHOW accepts an ordered mixture of images and videos on its saved images port. Source video audio is discarded; short video clips loop to fill their beat slot.',
    'AUDIO_TRIMMER is labelled Trimmer. Use mode=range for audio or video with startSeconds/endSeconds. Use mode=bars only for audio. Keep the saved audio input/output port ids.',
    'For a video from three random existing folder images: MEDIA_LIBRARY.images → PICK.items, PICK.selection → BEAT_SLIDESHOW.images. For music, use MEDIA_LIBRARY.audio → another PICK.items, then PICK.item → BEAT_SLIDESHOW.audio.',
    'To label each cut with its own filename, add MEDIA_LIBRARY.imageTitles → PICK.labels and PICK.labels → BEAT_SLIDESHOW.titles, then TEXT_OVERLAY template "{index}. {title}".',
    'Do not add MUSIC_SELECTOR to new workflows; it is retained only so old saved workflows still run.',
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
    'run_workflow action: {"kind":"run_workflow","summary":string,"workflowId":uuid,"workflowName":string}.',
    'CREATE_DRAFT and PUBLISH take title, caption, hashtags and firstComment as inputs as well as settings, and a connected input overrides the setting. Wire an IDEA_GENERATOR output into them when the user wants the copy written per run; leave the setting as typed text when the same wording should go out every time. Their mentions and link settings have no inputs and are typed only.',
    'IDEA_GENERATOR always outputs postTitle, caption and hashtags alongside prompts and titles, so connect those rather than adding additionalOutputs for them. To control how that copy reads, set its titleGuidance, captionGuidance or hashtagsGuidance settings — one instruction each, such as "two sentences, no emoji" — and leave them empty to let the model choose.',
    'IMAGE_GENERATOR and ANIMATE_IMAGE support useMockGeneration:true. Use it when the user is testing workflow structure or asks to avoid generation cost; leave it false for final creative output.',
    'Catalogue:',
    ...lines,
  ].join('\n');
}

export function weeklyReelTemplate(theme: string): {
  name: string;
  description: string;
  nodes: ProposedWorkflowNode[];
  edges: ProposedWorkflowEdge[];
} {
  const trimmed = theme.trim().slice(0, 80) || 'weekly reel';
  return {
    name: `${trimmed} reel`,
    description: `Generates stills from “${trimmed}”, cuts them to a track, labels each cut, and leaves a draft to review.`,
    nodes: [
      {
        key: 'idea',
        type: 'IDEA_GENERATOR',
        name: 'Theme ideas',
        positionX: 40,
        positionY: 40,
        config: { mode: 'image', theme: trimmed, count: 8, styleSuffix: '' },
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
        config: { template: '{index}', font: 'Archivo-Bold', position: 'top', fontSize: 0 },
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
      { sourceKey: 'idea', sourcePort: 'titles', targetKey: 'images', targetPort: 'titles' },
      { sourceKey: 'images', sourcePort: 'images', targetKey: 'slideshow', targetPort: 'images' },
      { sourceKey: 'images', sourcePort: 'titles', targetKey: 'slideshow', targetPort: 'titles' },
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
