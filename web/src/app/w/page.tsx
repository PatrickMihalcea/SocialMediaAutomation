import { redirect } from 'next/navigation';
import { listMyWorkspaces } from '@/lib/auth/guard';

export default async function WorkspaceIndex() {
  const workspaces = await listMyWorkspaces();
  if (!workspaces.length) redirect('/onboarding');
  redirect(`/w/${workspaces[0].slug}`);
}
