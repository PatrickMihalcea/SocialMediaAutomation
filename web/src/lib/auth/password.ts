import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);

/**
 * Always runs a real comparison. When the account has no password hash (Google-
 * only sign-up) we still burn a hash so the response time does not reveal
 * whether the address exists.
 */
export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, '$2a$12$0000000000000000000000000000000000000000000000000000');
    return false;
  }
  return bcrypt.compare(plain, hash);
}
