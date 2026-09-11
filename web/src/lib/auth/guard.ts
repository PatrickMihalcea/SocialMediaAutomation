import 'server-only';
import { cache } from 'react';
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

/** The signed-in user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await db.user.findUnique({ where: { id: session.user.id } });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    isPlatformAdmin: user.isPlatformAdmin,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return user;
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
  'billing:manage': 'manage billing',
};

const describe = (c: Capability) => VERBS[c] ?? `perform ${c}`;
