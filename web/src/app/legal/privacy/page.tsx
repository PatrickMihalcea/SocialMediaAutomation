export const metadata = {
  title: 'Privacy Policy',
  description: 'What Bridge88 stores, why, and how to remove it.',
};

const UPDATED = '16 September 2026';

export default function PrivacyPage() {
  return (
    <>
      <p className="b88-eyebrow">Legal</p>
      <h1 className="b88-page-title mt-3">Privacy Policy</h1>
      <p className="b88-caption mt-3">LAST UPDATED {UPDATED.toUpperCase()}</p>

      <p className="mt-8">
        Bridge88 schedules and publishes social media posts on your behalf. To do that it
        stores the posts you write, the media you upload, and access tokens for the accounts
        you connect. This page says exactly what is held, where, and how to get rid of it.
      </p>

      <h2 className="b88-heading mt-12">What is stored</h2>
      <dl className="mt-5 space-y-5">
        <div>
          <dt className="b88-label">Account</dt>
          <dd className="mt-1">Your email address, display name, a hashed password if you set one, and an optional profile image.</dd>
        </div>
        <div>
          <dt className="b88-label">Content</dt>
          <dd className="mt-1">Posts, captions, comments, approval decisions, workflows, and the images, video and audio you upload or generate.</dd>
        </div>
        <div>
          <dt className="b88-label">Connected accounts</dt>
          <dd className="mt-1">
            For each social account you connect: the platform, the account name and handle, the
            account identifier the platform assigns, and OAuth access and refresh tokens.
            Tokens are encrypted at rest with AES-256-GCM and are never shown back to you or
            written to logs.
          </dd>
        </div>
        <div>
          <dt className="b88-label">Activity</dt>
          <dd className="mt-1">An audit record of significant actions — publishing, approvals, member and billing changes — so a workspace can answer who did what.</dd>
        </div>
        <div>
          <dt className="b88-label">Analytics from platforms</dt>
          <dd className="mt-1">Public performance figures for posts published through Bridge88: impressions, reach, likes, comments, shares, saves, clicks and video views.</dd>
        </div>
      </dl>

      <p className="mt-6">
        Bridge88 does not use advertising trackers, does not sell or rent your data, and does not
        use your content to train machine learning models.
      </p>

      <h2 className="b88-heading mt-12">Google and YouTube data</h2>
      <p className="mt-4">
        Connecting a YouTube channel grants Bridge88 the scopes needed to upload videos, read your
        channel and video metadata, and read your YouTube Analytics. These are used only to publish
        the posts you schedule and to show you their performance inside your workspace.
      </p>
      <p className="mt-4">
        <strong>
          Bridge88&rsquo;s use of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" className="underline underline-offset-4">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </strong>{' '}
        Google user data is never transferred to third parties except as needed to provide or improve
        this service, is never used for advertising, and is never read by a human except with your
        explicit consent, for security purposes, or where required by law.
      </p>
      <p className="mt-4">
        By connecting a YouTube channel you also agree to the{' '}
        <a href="https://www.youtube.com/t/terms" className="underline underline-offset-4">YouTube Terms of Service</a>.
        Google&rsquo;s own handling of your data is described in the{' '}
        <a href="https://policies.google.com/privacy" className="underline underline-offset-4">Google Privacy Policy</a>.
      </p>
      <p className="mt-4">
        You can revoke Bridge88&rsquo;s access to your Google account at any time at{' '}
        <a href="https://myaccount.google.com/permissions" className="underline underline-offset-4">
          myaccount.google.com/permissions
        </a>
        . Doing so immediately stops any further access; anything already published stays on your
        channel and is yours to delete from YouTube.
      </p>

      <h2 className="b88-heading mt-12">Who else processes it</h2>
      <p className="mt-4">
        Bridge88 runs on third-party infrastructure. Each of these processes data only to provide
        its part of the service.
      </p>
      <ul className="mt-5 space-y-2">
        <li><strong>Vercel</strong> — application hosting.</li>
        <li><strong>Neon</strong> — the PostgreSQL database holding accounts, posts and settings.</li>
        <li><strong>Cloudflare R2</strong> — object storage for uploaded and generated media.</li>
        <li><strong>GitHub Actions</strong> — the scheduled worker that renders video and publishes due posts.</li>
        <li><strong>OpenAI</strong> — receives only the prompts and text you submit to an AI feature, plus images you ask it to edit. It receives no access tokens and no account data.</li>
        <li><strong>Resend</strong> — transactional email such as invitations and password resets.</li>
        <li><strong>The social platforms you connect</strong> — Instagram, Facebook, YouTube, LinkedIn, X and TikTok receive the content you publish to them, under their own terms.</li>
      </ul>

      <h2 className="b88-heading mt-12">How long it is kept</h2>
      <p className="mt-4">
        Content and connected accounts are kept until you delete them or delete your account.
        Disconnecting a social account deletes its stored tokens immediately. Deleting your
        account removes your profile, its uploaded profile image, and the workspaces you solely
        own, along with their posts and media. Audit records may be retained where needed to meet
        a legal or accounting obligation.
      </p>

      <h2 className="b88-heading mt-12">Your choices</h2>
      <ul className="mt-5 space-y-2">
        <li>Disconnect any social account from <strong>Social accounts</strong> in your workspace.</li>
        <li>Delete individual posts and media at any time.</li>
        <li>Delete your entire account from <strong>Your profile</strong>.</li>
        <li>Revoke platform access directly with Google, Meta, LinkedIn, X or TikTok.</li>
      </ul>

      <h2 className="b88-heading mt-12">Security</h2>
      <p className="mt-4">
        Traffic is served over HTTPS. OAuth tokens are encrypted at rest with AES-256-GCM under a
        key held outside the database. Passwords, when used, are stored as bcrypt hashes and are
        never recoverable. No system is perfectly secure, and this page does not promise otherwise.
      </p>

      <h2 className="b88-heading mt-12">Changes</h2>
      <p className="mt-4">
        Material changes will be reflected in the date at the top of this page. Continuing to use
        Bridge88 after a change means accepting the updated policy.
      </p>

      <h2 className="b88-heading mt-12">Contact</h2>
      <p className="mt-4">
        Questions about this policy, or a request to access or delete your data, can be sent to the
        address on the{' '}
        <a href="/legal/terms" className="underline underline-offset-4">Terms of Service</a> page.
      </p>
    </>
  );
}
