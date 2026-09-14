import { WorkspaceRole } from '@prisma/client';

/**
 * Capability matrix. Route handlers and server actions ask for a capability, not
 * a role, so a permission change happens in exactly one place. The client uses
 * the same table to hide controls, but every mutation re-checks server-side —
 * hiding a button is a courtesy, not a control.
 */
export const CAPABILITIES = [
  'workspace:view',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer',
  'member:view',
  'member:invite',
  'member:update_role',
  'member:remove',
  'brand:update',
  'channel:view',
  'channel:connect',
  'channel:disconnect',
  'media:view',
  'media:upload',
  'media:update',
  'media:delete',
  'post:view',
  'post:create',
  'post:update',
  'post:delete',
  'post:schedule',
  'post:publish',
  'post:submit_for_approval',
  'post:approve',
  'campaign:view',
  'campaign:manage',
  'schedule:manage',
  'analytics:view',
  'workflow:view',
  'workflow:edit',
  'workflow:run',
  'ai:use',
  'billing:view',
  'billing:manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const VIEWER: Capability[] = [
  'workspace:view',
  'member:view',
  'channel:view',
  'media:view',
  'post:view',
  'campaign:view',
  'analytics:view',
  'workflow:view',
];

const EDITOR: Capability[] = [
  ...VIEWER,
  'media:upload',
  'media:update',
  'media:delete',
  'post:create',
  'post:update',
  'post:delete',
  'post:schedule',
  'post:publish',
  'post:submit_for_approval',
  'campaign:manage',
  'schedule:manage',
  'ai:use',
  'workflow:edit',
  'workflow:run',
];

const ADMIN: Capability[] = [
  ...EDITOR,
  'workspace:update',
  'member:invite',
  'member:update_role',
  'member:remove',
  'brand:update',
  'channel:connect',
  'channel:disconnect',
  'post:approve',
  'billing:view',
];

const OWNER: Capability[] = [...ADMIN, 'workspace:delete', 'workspace:transfer', 'billing:manage'];

const MATRIX: Record<WorkspaceRole, ReadonlySet<Capability>> = {
  VIEWER: new Set(VIEWER),
  EDITOR: new Set(EDITOR),
  ADMIN: new Set(ADMIN),
  OWNER: new Set(OWNER),
};

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return MATRIX[role].has(capability);
}

export function capabilitiesFor(role: WorkspaceRole): Capability[] {
  return [...MATRIX[role]];
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

export const ROLE_DESCRIPTION: Record<WorkspaceRole, string> = {
  OWNER: 'Everything, including deleting the workspace and transferring ownership.',
  ADMIN: 'Everything except deleting the workspace or transferring ownership.',
  EDITOR: 'Create, edit and schedule content. Cannot change members or channels.',
  VIEWER: 'Read-only access to content, channels and analytics.',
};
