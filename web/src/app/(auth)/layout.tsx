export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" className="auth-shell" tabIndex={-1}>
      <section className="auth-story">
        <p className="text-xl font-[540]">Bridge88</p>
        <div className="auth-story-lede">
          <p className="b88-eyebrow">One workspace</p>
          <h1 className="b88-page-title mt-4 max-w-xl">Your channels, calendar and reviewers in one place.</h1>
        </div>
        <p className="b88-caption">Scheduling that tells you when it fails</p>
      </section>
      <section className="auth-form">{children}</section>
    </main>
  );
}
