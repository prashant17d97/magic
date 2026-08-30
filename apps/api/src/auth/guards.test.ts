import { describe, expect, it } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, type Permission, type Role, can } from '@magic/contracts';
import { PERMISSION_KEY, PermissionGuard, PUBLIC_KEY, ServiceTokenGuard } from './guards.js';
import { PRINCIPAL_KEY, principalFromHeaders } from './principal.js';

/**
 * The permission matrix, tested as a matrix.
 *
 * The security document marks this blocking on every commit, and the reason is that a role check
 * is easy to add and easy to forget: an endpoint shipped without one still works perfectly for
 * the person who wrote it, because they are an admin.
 */
const SERVICE_TOKEN = 'test_service_token_0123456789abcdef';
const TENANT = '00000000-0000-4000-8000-00000000aaaa';

function contextWith(headers: Record<string, unknown>, metadata: Record<string, unknown> = {}) {
  const request: Record<string, unknown> = { headers, id: 'req-1' };

  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as never;

  const reflector = {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;

  return { context, reflector, request };
}

describe('ServiceTokenGuard', () => {
  const config = { SERVICE_TOKEN } as never;

  it('rejects a request with no service token', () => {
    const { context, reflector } = contextWith({});
    const guard = new ServiceTokenGuard(config, reflector);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a service token that is close but not equal', () => {
    const { context, reflector } = contextWith({ 'x-service-token': `${SERVICE_TOKEN}x` });
    const guard = new ServiceTokenGuard(config, reflector);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a correct token that carries no resolvable principal', () => {
    const { context, reflector } = contextWith({ 'x-service-token': SERVICE_TOKEN });
    const guard = new ServiceTokenGuard(config, reflector);
    expect(() => guard.canActivate(context)).toThrow(/no resolvable principal/i);
  });

  it('rejects a role the system does not define', () => {
    const { context, reflector } = contextWith({
      'x-service-token': SERVICE_TOKEN,
      'x-magic-tenant-id': TENANT,
      'x-magic-role': 'superuser',
    });
    const guard = new ServiceTokenGuard(config, reflector);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('attaches the principal when the token and headers are good', () => {
    const { context, reflector, request } = contextWith({
      'x-service-token': SERVICE_TOKEN,
      'x-magic-tenant-id': TENANT,
      'x-magic-role': 'member',
      'x-magic-user-id': '00000000-0000-4000-8000-00000000bbbb',
      'x-magic-account-scope': 'acct_a,acct_b',
    });

    const guard = new ServiceTokenGuard(config, reflector);
    expect(guard.canActivate(context)).toBe(true);

    const principal = request[PRINCIPAL_KEY] as { role: string; accountScope: string[] | null };
    expect(principal.role).toBe('member');
    expect(principal.accountScope).toEqual(['acct_a', 'acct_b']);
  });

  it('lets the sign-in route through, since it runs before a principal exists', () => {
    const { context, reflector } = contextWith({}, { [PUBLIC_KEY]: true });
    const guard = new ServiceTokenGuard(config, reflector);
    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('PermissionGuard', () => {
  const ROLES: Role[] = ['admin', 'member', 'viewer'];

  it.each(
    ROLES.flatMap((role) => PERMISSIONS.map((permission) => [role, permission] as const)),
  )('%s against %s matches the declared matrix', (role, permission) => {
    const { context, reflector, request } = contextWith({}, { [PERMISSION_KEY]: permission });
    request[PRINCIPAL_KEY] = { role, permissions: [...rolePermissions(role)] };

    const guard = new PermissionGuard(reflector);
    const allowed = can(role, permission);

    if (allowed) {
      expect(guard.canActivate(context)).toBe(true);
    } else {
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    }
  });

  it('explains which capability was missing rather than saying no', () => {
    const { context, reflector, request } = contextWith({}, { [PERMISSION_KEY]: 'rule:write' });
    request[PRINCIPAL_KEY] = { role: 'member', permissions: [...rolePermissions('member')] };

    const guard = new PermissionGuard(reflector);
    expect(() => guard.canActivate(context)).toThrow(/member role does not carry the rule:write/);
  });

  it('allows a route that declares no permission at all', () => {
    const { context, reflector } = contextWith({});
    const guard = new PermissionGuard(reflector);
    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('principalFromHeaders', () => {
  it('treats an empty account scope header as unrestricted rather than as an empty list', () => {
    const principal = principalFromHeaders(
      { 'x-magic-tenant-id': TENANT, 'x-magic-role': 'admin', 'x-magic-account-scope': '' },
      'req-1',
    );
    expect(principal?.accountScope).toBeNull();
  });

  it('takes only the first hop from a forwarded-for chain', () => {
    const principal = principalFromHeaders(
      { 'x-magic-tenant-id': TENANT, 'x-magic-role': 'admin', 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
      'req-1',
    );
    expect(principal?.ipAddress).toBe('203.0.113.9');
  });

  it('returns nothing when the tenant is absent', () => {
    expect(principalFromHeaders({ 'x-magic-role': 'admin' }, 'req-1')).toBeNull();
  });
});

function rolePermissions(role: Role): readonly Permission[] {
  return PERMISSIONS.filter((permission) => can(role, permission));
}
