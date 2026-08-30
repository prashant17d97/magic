import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, tap } from 'rxjs';
import type { Database } from '@magic/db';
import { schema, withTenant } from '@magic/db';
import { redact } from '@magic/security';
import { DATABASE } from './database.module.js';
import { PRINCIPAL_KEY } from '../auth/principal.js';
import type { Principal } from '../auth/principal.js';

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * The audit log is written by an interceptor rather than by handlers.
 *
 * Application code cannot write to it directly, which means a new endpoint added next month is
 * audited by construction instead of by whoever remembers. The table's UPDATE and DELETE grants
 * are revoked, so the record is append-only as a database property, not a convention.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url: string;
      body?: unknown;
      params?: Record<string, string>;
      [PRINCIPAL_KEY]?: Principal;
    }>();

    if (!AUDITED_METHODS.has(request.method)) return next.handle();

    const principal = request[PRINCIPAL_KEY];
    if (!principal) return next.handle();

    const action = deriveAction(request.method, request.url);
    const resourceId = request.params?.['id'] ?? request.params?.['ruleId'] ?? 'collection';

    return next.handle().pipe(
      tap({
        next: (result) => {
          void this.record(principal, action, resourceId, request.body, result);
        },
      }),
    );
  }

  private async record(
    principal: Principal,
    action: string,
    resourceId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    try {
      await withTenant(this.db, { tenantId: principal.tenantId }, async (tx) => {
        await tx.insert(schema.auditLog).values({
          tenantId: principal.tenantId,
          actorUserId: principal.userId,
          actorType: principal.userId ? 'user' : 'api',
          action,
          resourceType: action.split('.')[0] ?? 'unknown',
          resourceId,
          before: redact(before) as Record<string, unknown>,
          after: redact(after) as Record<string, unknown>,
          ipAddress: principal.ipAddress,
          userAgent: principal.userAgent,
          requestId: principal.requestId,
        });
      });
    } catch (error) {
      this.logger.error({ err: error, action }, 'Failed to write an audit entry.');
    }
  }
}

function deriveAction(method: string, url: string): string {
  const path = url.split('?')[0] ?? url;
  const segments = path.split('/').filter((s) => s.length > 0 && s !== 'v1');
  const resource = segments[0] ?? 'unknown';
  const verb = segments[segments.length - 1];

  if (verb && verb !== resource && !/^[0-9a-f-]{16,}$/i.test(verb)) {
    return `${singular(resource)}.${verb}`;
  }

  return `${singular(resource)}.${method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update'}`;
}

function singular(resource: string): string {
  return resource.endsWith('s') ? resource.slice(0, -1) : resource;
}
