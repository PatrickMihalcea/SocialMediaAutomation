import Link from 'next/link';

/**
 * Shared frame for the legal pages.
 *
 * Deliberately outside the workspace shell: these have to load for someone who
 * is not signed in and has no workspace — Google and Meta both fetch them
 * during app review, and a policy behind a login is the same as no policy.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="b88-caption">BRIDGE88</Link>
      <div className="b88-legal mt-10">{children}</div>
      <footer className="mt-16 flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline-soft pt-6">
        <Link href="/legal/privacy" className="b88-caption">PRIVACY</Link>
        <Link href="/legal/terms" className="b88-caption">TERMS</Link>
        <Link href="/" className="b88-caption">HOME</Link>
      </footer>
    </main>
  );
}
