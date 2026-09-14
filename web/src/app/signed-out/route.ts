import { redirect } from 'next/navigation';
import { signOut } from '@/auth';
import { getCurrentUser } from '@/lib/auth/guard';

/**
 * Drops a session cookie that can no longer be resolved to a user, which is the
 * only way out of the loop such a cookie creates: every guarded page throws,
 * and middleware refuses to show /login while the cookie is present.
 *
 * A session that still resolves is left alone, so this cannot be used as a
 * drive-by logout link against a signed-in visitor.
 */
export async function GET() {
  if (await getCurrentUser()) redirect('/w');
  await signOut({ redirectTo: '/login' });
}
