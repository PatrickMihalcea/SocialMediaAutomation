import { ComposerPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Composer" title="Create a post" />
      <div className="mt-8">
        <ComposerPagePreview />
      </div>
    </>
  );
}
