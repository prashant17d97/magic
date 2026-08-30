import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Permission, type Role, permissionsFor } from '@magic/contracts';

/**
 * The caller as the BFF asserts it. Tenant, role and account scope come from the server-side
 * session and are forwarded as headers on an internal-only network — the browser never supplies
 * any of them, and the API is not routable from the internet.
 */
export interface Principal {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly role: Role;
  readonly accountScope: string[] | null;
  readonly permissions: readonly Permission[];
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export const PRINCIPAL_KEY = 'magicPrincipal';

export function principalFromHeaders(headers: Record<string, unknown>, requestId: string): Principal | null {
  const tenantId = header(headers, 'x-magic-tenant-id');
  const role = header(headers, 'x-magic-role') as Role | null;

  if (!tenantId || !role || !['admin', 'member', 'viewer'].includes(role)) return null;

  const rawScope = header(headers, 'x-magic-account-scope');
  const accountScope = rawScope && rawScope.trim().length > 0 ? rawScope.split(',').map((s) => s.trim()) : null;

  return {
    tenantId,
    userId: header(headers, 'x-magic-user-id'),
    role,
    accountScope,
    permissions: permissionsFor(role),
    requestId,
    ipAddress: header(headers, 'x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: header(headers, 'user-agent'),
  };
}

function header(headers: Record<string, unknown>, name: string): string | null {
  const value = headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  const request = context.switchToHttp().getRequest<Record<string, unknown>>();
  return request[PRINCIPAL_KEY] as Principal;
});
