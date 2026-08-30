import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { Permission } from '@magic/contracts';
import { CONFIG, type ApiConfig } from '../config.js';
import { PRINCIPAL_KEY, principalFromHeaders } from './principal.js';

export const PERMISSION_KEY = 'magic:permission';
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

export const SCOPED_KEY = 'magic:scoped';
export const ScopedToAccount = () => SetMetadata(SCOPED_KEY, true);

export const PUBLIC_KEY = 'magic:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * The first of three independent authorisation layers.
 *
 * This one proves the caller is the BFF and carries a principal. It does not prove the principal
 * may do anything — that is the permission guard's job — and it does not prove tenant isolation,
 * which is row-level security's job. None of the three is trusted alone.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly config: ApiConfig,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown>; id?: string }>();
    const provided = request.headers['x-service-token'];

    if (typeof provided !== 'string' || !constantTimeEquals(provided, this.config.SERVICE_TOKEN)) {
      throw new UnauthorizedException('The service token is missing or incorrect.');
    }

    const principal = principalFromHeaders(request.headers, request.id ?? 'unknown');
    if (!principal) {
      throw new UnauthorizedException('The request carries no resolvable principal.');
    }

    (request as Record<string, unknown>)[PRINCIPAL_KEY] = principal;
    return true;
  }
}

/**
 * The second layer: role capability. Without it a Viewer could resolve exceptions — bad, but
 * contained within the tenant, which is exactly why row-level security sits underneath.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const principal = request[PRINCIPAL_KEY] as { permissions: readonly Permission[]; role: string } | undefined;

    if (!principal?.permissions.includes(required)) {
      throw new ForbiddenException(
        `The ${principal?.role ?? 'unknown'} role does not carry the ${required} capability.`,
      );
    }

    return true;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
