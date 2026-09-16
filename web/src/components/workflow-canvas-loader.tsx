'use client';

import dynamic from 'next/dynamic';
import type { CanvasEdge, CanvasNode } from '@/components/workflow-canvas';
import type {
  WorkflowAudioOption,
  WorkflowChannelOption,
  WorkflowMediaAssetOption,
  WorkflowMediaCounts,
  WorkflowMediaFolderOption,
} from '@/lib/workflows/definitions';

/**
 * Loads the canvas only when the Steps tab is open.
 *
 * React Flow is around 90kB, and the Runs view — the one people land on — has no
 * use for it. `ssr: false` because the canvas measures the DOM to lay edges out,
 * so there is nothing useful to render on the server anyway.
 */
const Canvas = dynamic(
  () => import('@/components/workflow-canvas').then((m) => m.WorkflowCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        className="b88-card flex h-[600px] items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <p className="b88-caption">LOADING THE PIPELINE EDITOR</p>
      </div>
    ),
  },
);

export function WorkflowCanvasLoader(props: {
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
  return <Canvas {...props} />;
}
