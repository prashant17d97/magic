import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuditQuerySchema,
  CreateRunSchema,
  CursorQuerySchema,
  ExportRequestSchema,
  MemberPatchSchema,
  RulePatchSchema,
  RunQuerySchema,
  SavedViewCreateSchema,
  SettlementQuerySchema,
  SignInSchema,
} from '@magic/contracts';
import { z } from 'zod';
import { AuditInterceptor } from '../platform/audit.interceptor.js';
import { Public, RequirePermission } from '../auth/guards.js';
import { CurrentPrincipal, type Principal } from '../auth/principal.js';
import { HealthService } from './health.service.js';
import { AccountsService, RulesService, RunsService, SettlementsService } from './operations.service.js';
import {
  AuditService,
  AuthService,
  ExportsService,
  MembersService,
  OpsService,
  SavedViewsService,
} from './workspace.service.js';

@Controller('v1/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('summary')
  @RequirePermission('exception:read')
  async summary(@CurrentPrincipal() principal: Principal) {
    return this.health.summary(principal);
  }
}

@Controller('v1/runs')
@UseInterceptors(AuditInterceptor)
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  @RequirePermission('run:read')
  async list(@CurrentPrincipal() principal: Principal, @Query() query: Record<string, unknown>) {
    return this.runs.list(principal, RunQuerySchema.parse(query));
  }

  @Get(':id')
  @RequirePermission('run:read')
  async detail(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.detail(principal, id);
  }

  @Post()
  @RequirePermission('run:trigger')
  async trigger(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.runs.trigger(principal, CreateRunSchema.parse(body));
  }
}

@Controller('v1/settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get()
  @RequirePermission('settlement:read')
  async list(@CurrentPrincipal() principal: Principal, @Query() query: Record<string, unknown>) {
    return this.settlements.list(principal, SettlementQuerySchema.parse(query));
  }

  @Get(':chargeId')
  @RequirePermission('settlement:read')
  async detail(@CurrentPrincipal() principal: Principal, @Param('chargeId') chargeId: string) {
    return this.settlements.detail(principal, chargeId);
  }
}

@Controller('v1/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermission('account:read')
  async list(@CurrentPrincipal() principal: Principal) {
    return this.accounts.list(principal);
  }

  @Get(':id/completeness')
  @RequirePermission('account:read')
  async completeness(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.accounts.completeness(principal, id);
  }
}

@Controller('v1/rules')
@UseInterceptors(AuditInterceptor)
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  @RequirePermission('rule:read')
  async list(@CurrentPrincipal() principal: Principal) {
    return { data: await this.rules.list(principal) };
  }

  @Patch(':ruleId')
  @RequirePermission('rule:write')
  async patch(
    @CurrentPrincipal() principal: Principal,
    @Param('ruleId') ruleId: string,
    @Body() body: unknown,
  ) {
    return this.rules.patch(principal, ruleId, RulePatchSchema.parse(body));
  }
}

@Controller('v1/exports')
@UseInterceptors(AuditInterceptor)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get()
  @RequirePermission('export:read')
  async list(@CurrentPrincipal() principal: Principal, @Query() query: Record<string, unknown>) {
    return this.exports.list(principal, CursorQuerySchema.parse(query).limit);
  }

  @Get(':id')
  @RequirePermission('export:read')
  async detail(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.exports.detail(principal, id);
  }

  @Post()
  @HttpCode(202)
  @RequirePermission('export:create')
  async create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.exports.create(principal, ExportRequestSchema.parse(body));
  }
}

@Controller('v1/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  async list(@CurrentPrincipal() principal: Principal, @Query() query: Record<string, unknown>) {
    return this.audit.list(principal, AuditQuerySchema.parse(query));
  }
}

@Controller('v1/members')
@UseInterceptors(AuditInterceptor)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('member:read')
  async list(@CurrentPrincipal() principal: Principal) {
    return this.members.list(principal);
  }

  @Patch(':id')
  @RequirePermission('member:write')
  async patch(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.members.patch(principal, id, MemberPatchSchema.parse(body));
  }
}

@Controller('v1/saved-views')
@UseInterceptors(AuditInterceptor)
export class SavedViewsController {
  constructor(private readonly views: SavedViewsService) {}

  @Get()
  @RequirePermission('exception:read')
  async list(@CurrentPrincipal() principal: Principal, @Query('resource') resource?: string | undefined) {
    return this.views.list(principal, resource);
  }

  @Post()
  @RequirePermission('exception:read')
  async create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    return this.views.create(principal, SavedViewCreateSchema.parse(body));
  }

  @Delete(':id')
  @RequirePermission('exception:read')
  async remove(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.remove(principal, id);
  }
}

@Controller('v1/ops')
@UseInterceptors(AuditInterceptor)
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('dlq')
  @RequirePermission('ops:dlq')
  async list(@CurrentPrincipal() principal: Principal, @Query() query: Record<string, unknown>) {
    return this.ops.listDeadLetters(principal, CursorQuerySchema.parse(query).limit);
  }

  @Post('dlq/:id/replay')
  @RequirePermission('ops:dlq')
  async replay(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    return this.ops.replay(principal, id);
  }
}

const TenantSwitchSchema = z.object({ user_id: z.string().uuid(), tenant_id: z.string().uuid() });

/**
 * Credential verification for the BFF. Marked public because it runs before a principal exists;
 * it is still reachable only from the internal network and only with the service token, which
 * the guard checks for every other route.
 */
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('sign-in')
  @Public()
  async signIn(@Body() body: unknown) {
    const parsed = SignInSchema.parse(body);
    return this.auth.signIn(parsed.email, parsed.password);
  }

  @Post('session')
  @Public()
  async session(@Body() body: unknown) {
    const parsed = TenantSwitchSchema.parse(body);
    return this.auth.sessionFor(parsed.user_id, parsed.tenant_id);
  }
}
