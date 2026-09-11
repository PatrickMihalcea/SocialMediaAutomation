import { SettingsPagePreview } from '@/components/page-previews';

export default function Loading() {
  return (
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-12 md:px-12" tabIndex={-1}>
      <p className="b88-eyebrow">Account</p>
      <h1 className="b88-page-title mt-3">Profile settings</h1>
      <SettingsPagePreview />
    </main>
  );
}
