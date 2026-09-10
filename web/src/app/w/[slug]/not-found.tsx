import { Button, EmptyState } from '@/bridge88/components';

export default function WorkspaceNotFound() {
  return (
    <EmptyState
      eyebrow="Not found"
      title="This workspace item is not here"
      action={<Button href="/w">Choose a workspace</Button>}
    >
      It may have been removed, or you may not have access.
    </EmptyState>
  );
}
