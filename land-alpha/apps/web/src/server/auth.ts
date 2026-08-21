import 'server-only';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { prisma } from '@land-alpha/db';
import { AuthorizationError, type UserRole } from '@land-alpha/shared';
import { env } from '@land-alpha/shared/env';

/**
 * Session authentication.
 *
 * Opaque random session tokens stored as SHA-256 hashes, in an HttpOnly,
 * SameSite=Lax cookie. Deliberately not a JWT: sessions must be revocable
 * server-side the moment an analyst leaves, and there is nothing in this
 * product that benefits from stateless verification.
 *
 * The raw token never touches the database, so a database compromise does not
 * hand over live sessions.
 */

const COOKIE_NAME = 'la_session';
const TOKEN_BYTES = 32;

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (derived.length !== expectedBuffer.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<void> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const ttlHours = env().SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      // Store only a hash of the address: enough to spot session theft, not
      // enough to build a location history of our own staff.
      ipHash: meta.ip ? createHash('sha256').update(meta.ip).digest('hex').slice(0, 32) : null,
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(COOKIE_NAME);
}

/**
 * Current user, or null. Cached per request so a page that checks
 * authorization in six components issues one query, not six.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
    },
  });

  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthorizationError('Authentication required');
  return user;
}

const ROLE_RANK: Record<UserRole, number> = { VIEWER: 1, ANALYST: 2, ADMIN: 3 };

export function hasRole(user: SessionUser, minimum: UserRole): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[minimum];
}

export async function requireRole(minimum: UserRole): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user, minimum)) {
    throw new AuthorizationError(`This action requires the ${minimum} role.`);
  }
  return user;
}

/** Purge expired sessions. Called opportunistically on login. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
