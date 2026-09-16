export const metadata = {
  title: 'Terms of Service',
  description: 'The terms you accept by using Bridge88.',
};

const UPDATED = '16 September 2026';

export default function TermsPage() {
  return (
    <>
      <p className="b88-eyebrow">Legal</p>
      <h1 className="b88-page-title mt-3">Terms of Service</h1>
      <p className="b88-caption mt-3">LAST UPDATED {UPDATED.toUpperCase()}</p>

      <p className="mt-8">
        These terms cover your use of Bridge88, a tool for composing, scheduling and publishing
        social media posts. Using the service means accepting them.
      </p>

      <h2 className="b88-heading mt-12">The service</h2>
      <p className="mt-4">
        Bridge88 lets you write posts, generate and edit media, build automated workflows, and
        publish to social accounts you connect. It acts on your instructions and on schedules you
        configure, including while you are not signed in.
      </p>

      <h2 className="b88-heading mt-12">Your account</h2>
      <p className="mt-4">
        You are responsible for what happens under your account and for keeping your credentials
        secure. You must be old enough to enter a contract where you live, and old enough to hold
        an account on each platform you connect.
      </p>

      <h2 className="b88-heading mt-12">Your content</h2>
      <p className="mt-4">
        Your content stays yours. You grant Bridge88 only the permission needed to run the service:
        to store your content, transform it as you instruct, and transmit it to the platforms you
        have connected.
      </p>
      <p className="mt-4">
        You confirm you have the rights to everything you upload and publish — including images,
        video, music and anything generated with the AI features. Music in particular is a common
        trap: a track you did not license can have a post muted or removed by the platform.
      </p>

      <h2 className="b88-heading mt-12">Connected platforms</h2>
      <p className="mt-4">
        Publishing through Bridge88 does not exempt you from each platform&rsquo;s own rules. You
        remain bound by the terms of Instagram, Facebook, YouTube, LinkedIn, X and TikTok for
        anything sent to them, including the{' '}
        <a href="https://www.youtube.com/t/terms" className="underline underline-offset-4">YouTube Terms of Service</a>.
        Platforms may reject, rate-limit, or remove content, and may revoke access at any time.
        Bridge88 has no control over those decisions.
      </p>

      <h2 className="b88-heading mt-12">Acceptable use</h2>
      <p className="mt-4">Do not use Bridge88 to:</p>
      <ul className="mt-5 space-y-2">
        <li>publish content that is unlawful, harassing, deceptive, or infringes someone else&rsquo;s rights;</li>
        <li>impersonate a person or organisation, or post on an account without authorisation;</li>
        <li>send spam or run coordinated inauthentic activity;</li>
        <li>evade a platform&rsquo;s rate limits, review processes, or enforcement;</li>
        <li>attempt to breach, overload or reverse engineer the service.</li>
      </ul>

      <h2 className="b88-heading mt-12">AI features</h2>
      <p className="mt-4">
        AI-generated text and images are produced by third-party models and can be wrong,
        derivative, or unsuitable. Review anything generated before it goes out. You are
        responsible for what you publish, whoever or whatever drafted it.
      </p>

      <h2 className="b88-heading mt-12">Availability</h2>
      <p className="mt-4">
        Bridge88 is provided as is, without warranty. Scheduled work runs on a polling worker and
        on platform APIs, so publishing times are approximate and a platform outage can delay or
        prevent a post. Do not rely on it for time-critical publishing without checking the result.
      </p>

      <h2 className="b88-heading mt-12">Liability</h2>
      <p className="mt-4">
        To the extent the law allows, Bridge88 is not liable for indirect or consequential loss,
        lost profits, lost data, or for content published through the service. Nothing here excludes
        liability that cannot lawfully be excluded.
      </p>

      <h2 className="b88-heading mt-12">Ending it</h2>
      <p className="mt-4">
        You can stop using Bridge88 and delete your account at any time from{' '}
        <strong>Your profile</strong>. Access may be suspended or ended if these terms are broken
        or if required to protect the service or another user.
      </p>

      <h2 className="b88-heading mt-12">Changes</h2>
      <p className="mt-4">
        These terms may change; the date above will reflect it. Continuing to use Bridge88 after a
        change means accepting the updated terms.
      </p>

      <h2 className="b88-heading mt-12">Contact</h2>
      <p className="mt-4">
        Questions about these terms, privacy, or a data request:{' '}
        <a href="mailto:patrick.mihalcea01@gmail.com" className="underline underline-offset-4">
          patrick.mihalcea01@gmail.com
        </a>
        .
      </p>
    </>
  );
}
