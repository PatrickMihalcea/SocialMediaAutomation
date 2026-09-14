/**
 * What a node executor is handed. Kept separate from the engine so a node can
 * import the type without importing the scheduler.
 */
export interface NodeRunContext {
  workspaceId: string;
  runId: string;
  nodeRunId: string;
  nodeName: string;
  /** The workflow's name, used to name the media a step produces. */
  workflowName: string;
  /** Null for a scheduled run — nobody is signed in. */
  userId: string | null;
  /** 1 on the first try. */
  attempt: number;
  /** Already parsed through the node's Zod schema, defaults applied. */
  config: unknown;
  /** Port id to value, resolved from upstream outputs. */
  inputs: Record<string, unknown>;
  /** Partial output from a previous attempt, so batch work can resume. */
  previousOutput: Record<string, unknown> | null;

  /** Throws CancelledError if the run was cancelled. Call between awaits. */
  assertNotCancelled(): Promise<void>;
  /** Keeps the sweeper from reclaiming a long step. Call inside long loops. */
  heartbeat(): Promise<void>;
  /** Persists partial output mid-run so a retry can skip completed work. */
  saveProgress(partial: Record<string, unknown>): Promise<void>;
  /** Records produced media against this step, for provenance. */
  emitAssets(port: string, assetIds: string[]): Promise<void>;
}

export type NodeExecutor = (ctx: NodeRunContext) => Promise<Record<string, unknown>>;

/** Thrown by assertNotCancelled. Handled by the engine, never by a node. */
export class CancelledError extends Error {
  constructor() {
    super('This run was cancelled.');
    this.name = 'CancelledError';
  }
}
