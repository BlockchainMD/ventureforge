'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@land-alpha/db';
import { createSession, pruneExpiredSessions, verifyPassword } from '@/server/auth';

export interface LoginState {
  error: string | null;
}

/**
 * Sign in.
 *
 * The failure message is deliberately identical for "no such user" and "wrong
 * password", and the password verification runs even when no user was found, so
 * response timing does not disclose which accounts exist.
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/dashboard');

  if (!email || !password) return { error: 'Enter an email address and password.' };

  const user = await prisma.user.findUnique({ where: { email } });
  const DUMMY_HASH =
    'scrypt$0000000000000000000000000000000000000000000000000000000000000000$00';
  const valid = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid || !user.isActive) {
    return { error: 'Those credentials were not recognised.' };
  }

  const headerList = await headers();
  await createSession(user.id, {
    userAgent: headerList.get('user-agent'),
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });
  void pruneExpiredSessions().catch(() => undefined);

  // Only same-origin relative paths are honoured, so a crafted `next` cannot
  // turn the login form into an open redirect.
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
}
