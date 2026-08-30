import type {Role} from './primitives.js';

/**
 * The capability list is the single source of truth for the PRD role matrix. Guards on the API
 * and navigation gating on the web app both read it, so the two cannot drift apart.
 */
export const PERMISSIONS = [
    'exception:read',
    'exception:transition',
    'exception:assign',
    'exception:note',
    'run:read',
    'run:trigger',
    'settlement:read',
    'account:read',
    'export:create',
    'export:read',
    'rule:read',
    'rule:write',
    'member:read',
    'member:write',
    'connection:read',
    'connection:write',
    'audit:read',
    'ops:dlq',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: Permission[] = [
    'exception:read',
    'run:read',
    'settlement:read',
    'account:read',
    'export:create',
    'export:read',
    'rule:read',
    'audit:read',
];

const MEMBER: Permission[] = [
    ...VIEWER.filter((p) => p !== 'audit:read'),
    'exception:transition',
    'exception:assign',
    'exception:note',
    'run:trigger',
];

const ADMIN: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
    admin: ADMIN,
    member: MEMBER,
    viewer: VIEWER,
};

export function permissionsFor(role: Role): Permission[] {
    return [...ROLE_PERMISSIONS[role]];
}

export function can(role: Role, permission: Permission): boolean {
    return ROLE_PERMISSIONS[role].includes(permission);
}
