import { LoadingState } from '@/bridge88/components';

export default function RootLoading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:px-12">
      <LoadingState label="Loading Bridge88" />
    </div>
  );
}
