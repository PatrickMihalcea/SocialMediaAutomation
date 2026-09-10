import { Button, EmptyState } from '@/bridge88/components';

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-16" tabIndex={-1}>
      <EmptyState
        eyebrow="Not found"
        title="This page is not here"
        action={<Button href="/">Go to Bridge88</Button>}
      >
        Check the address or return to the home page.
      </EmptyState>
    </main>
  );
}
