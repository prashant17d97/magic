import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  BulkAssignSchema,
  BulkIgnoreSchema,
  ExceptionQuerySchema,
  ExceptionTransitionSchema,
} from '@magic/contracts';
import { AuditInterceptor } from '../platform/audit.interceptor.js';
import { RequirePermission } from '../auth/guards.js';
import { CurrentPrincipal, type Principal } from '../auth/principal.js';
import { ExceptionsService } from './exceptions.service.js';

/**
 * Query parameters are validated at the boundary with the same Zod schemas the web app compiles
 * against, so a filter the console can express is a filter the API accepts and nothing else is.
 */
@Controller('v1/exceptions')
@UseInterceptors(AuditInterceptor)
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get()
  @RequirePermission('exception:read')
  async list(@CurrentPrincipal() principal: Principal, @Query() query: Record<string, unknown>) {
    return this.exceptions.list(principal, ExceptionQuerySchema.parse(query));
  }

  @Get('counts')
  @RequirePermission('exception:read')
  async counts(@CurrentPrincipal() principal: Principal) {
    return this.exceptions.counts(principal);
  }

  @Get(':id')
  @RequirePermission('exception:read')
  async detail(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.detail(principal, id);
  }

  @Post(':id/transitions')
  @RequirePermission('exception:transition')
  async transition(
    @CurrentPrincipal() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = ExceptionTransitionSchema.parse(body);
    return this.exceptions.transition(principal, id, parsed.to, parsed.note);
  }

  @Post('bulk/ignore')
  @RequirePermission('exception:transition')
  async bulkIgnore(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const parsed = BulkIgnoreSchema.parse(body);
    return this.exceptions.bulkIgnore(principal, parsed.ids, parsed.note);
  }

  @Post('bulk/assign')
  @RequirePermission('exception:assign')
  async bulkAssign(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const parsed = BulkAssignSchema.parse(body);
    return this.exceptions.bulkAssign(principal, parsed.ids, parsed.assignee_id);
  }
}
