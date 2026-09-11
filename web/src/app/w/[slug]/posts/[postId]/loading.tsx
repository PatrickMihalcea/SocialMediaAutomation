import { ComposerPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <>
      <PageTitle eyebrow="Post" title="Post detail" />
      <div className="mt-8">
        <ComposerPagePreview />
      </div>
    </>
  );
}
