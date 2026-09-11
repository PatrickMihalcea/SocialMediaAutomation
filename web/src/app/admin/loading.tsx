import { AdminPagePreview, PageTitle } from '@/components/page-previews';

export default function Loading() {
  return (
    <main id="main-content" className="mx-auto max-w-[1280px] px-6 py-12 md:px-12" tabIndex={-1}>
      <p className="text-xl font-[540]">Bridge88</p>
      <div className="mt-12">
        <PageTitle eyebrow="Platform administration" title="System health" />
        <AdminPagePreview />
      </div>
    </main>
  );
}
