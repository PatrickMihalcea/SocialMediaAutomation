import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Workspace, WorkspaceRole } from '@prisma/client';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { forbidden, notFound, unauthenticated } from '@/lib/errors';
import { can, capabilitiesFor, type Capability } from '@/lib/auth/rbac';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  isPlatformAdmin: boolean;
}

export interface WorkspaceContext {
  user: SessionUser;
  workspace: Workspace;
  role: WorkspaceRole;
  capabilities: Capability[];
  can: (capability: Capability) => boolean;
}

/**
 * `stale` is a correctly signed cookie naming a user that no longer exists —
 * a deleted account, or a database restored under a running browser session.
 * It has to be told apart from `anonymous`: the cookie satisfies middleware,
 * so the request reaches the page and then has nowhere to go.
 */
type SessionState =
  | { kind: 'anonymous' }
  | { kind: 'stale' }
  | { kind: 'active'; user: SessionUser };

const loadSession = cache(async (): Promise<SessionState> => {
  const session = await auth();
  if (!session?.user?.id) return { kind: 'anonymous' };
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) return { kind: 'stale' };
  return {
    kind: 'active',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      isPlatformAdmin: user.isPlatformAdmin,
    },
  };
});

/** The signed-in user, or null. Cached per request. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const state = await loadSession();
  return state.kind === 'active' ? state.user : null;
}

export async function requireUser(): Promise<SessionUser> {
  const state = await loadSession();
  if (state.kind === 'active') return state.user;
  // Sending a stale session to /login would loop: middleware sees the cookie,
  // counts the visitor as signed in and bounces them back to /w. The cookie
  // has to be dropped first.
  if (state.kind === 'stale') redirect('/signed-out');
  throw unauthenticated();
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) throw forbidden('This area is restricted to platform administrators.');
  return user;
}

/**
 * The single door into workspace-scoped data.
 *
 * Membership is looked up from the authenticated user id and the workspace
 * slug/id in the URL; the client never supplies a role or a workspace it is
 * trusted on. A non-member gets NOT_FOUND rather than FORBIDDEN so the response
 * does not confirm that a workspace with that slug exists.
 */
export const resolveWorkspace = cache(async (slugOrId: string): Promise<WorkspaceContext> => {
  const user = await requireUser();

  const membership = await db.workspaceMember.findFirst({
    where: {
      userId: user.id,
      workspace: isUuid(slugOrId) ? { OR: [{ id: slugOrId }, { slug: slugOrId }] } : { slug: slugOrId },
    },
    include: { workspace: true },
  });

  if (!membership) throw notFound('That workspace does not exist, or you no longer have access to it.');

  return {
    user,
    workspace: membership.workspace,
    role: membership.role,
    capabilities: capabilitiesFor(membership.role),
    can: (capability: Capability) => can(membership.role, capability),
  };
});

/** Resolve the workspace and assert one capability in a single call. */
export async function requireWorkspace(slugOrId: string, capability?: Capability): Promise<WorkspaceContext> {
  const ctx = await resolveWorkspace(slugOrId);
  if (capability && !ctx.can(capability)) {
    throw forbidden(`Your role (${ctx.role.toLowerCase()}) cannot ${describe(capability)}.`);
  }
  return ctx;
}

export function assertCan(ctx: WorkspaceContext, capability: Capability): void {
  if (!ctx.can(capability)) {
    throw forbidden(`Your role (${ctx.role.toLowerCase()}) cannot ${describe(capability)}.`);
  }
}

/** Workspaces the current user belongs to, for the switcher. */
export const listMyWorkspaces = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return [];
  const memberships = await db.workspaceMember.findMany({
    where: { userId: user.id },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          slug: true,
          name: true,
          onboardedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string) => UUID_RE.test(v);

const VERBS: Partial<Record<Capability, string>> = {
  'workspace:update': 'change workspace settings',
  'workspace:delete': 'delete this workspace',
  'workspace:transfer': 'transfer ownership',
  'member:invite': 'invite members',
  'member:update_role': 'change member roles',
  'member:remove': 'remove members',
  'brand:update': 'edit the brand voice',
  'channel:connect': 'connect channels',
  'channel:disconnect': 'disconnect channels',
  'media:upload': 'upload media',
  'media:delete': 'delete media',
  'post:create': 'create posts',
  'post:update': 'edit posts',
  'post:delete': 'delete posts',
  'post:schedule': 'schedule posts',
  'post:publish': 'publish posts',
  'post:approve': 'approve posts',
  'campaign:manage': 'manage campaigns',
  'schedule:manage': 'change the queue',
  'ai:use': 'use the AI tools',
  'workflow:edit': 'build or change workflows',
  'workflow:run': 'run workflows',
  'billing:manage': 'manage billing',
};

const describe = (c: Capability) => VERBS[c] ?? `perform ${c}`;
