import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './platform/database.module.js';
import { ProblemDetailsFilter } from './platform/problem.filter.js';
import { AuditInterceptor } from './platform/audit.interceptor.js';
import { PermissionGuard, ServiceTokenGuard } from './auth/guards.js';
import { ExceptionsController } from './modules/exceptions.controller.js';
import { ExceptionsService } from './modules/exceptions.service.js';
import { HealthService } from './modules/health.service.js';
import { AccountsService, RulesService, RunsService, SettlementsService } from './modules/operations.service.js';
import {
  AuditService,
  AuthService,
  ExportsService,
  MembersService,
  OpsService,
  SavedViewsService,
} from './modules/workspace.service.js';
import {
  AccountsController,
  AuditController,
  AuthController,
  ExportsController,
  HealthController,
  MembersController,
  OpsController,
  RulesController,
  RunsController,
  SavedViewsController,
  SettlementsController,
} from './modules/console.controller.js';

/**
 * Both guards are registered globally rather than per controller. A route added later is
 * protected by default, which is the only ordering that survives a busy week: a forgotten
 * decorator should fail closed, not open.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    ExceptionsController,
    RunsController,
    SettlementsController,
    AccountsController,
    RulesController,
    ExportsController,
    AuditController,
    MembersController,
    SavedViewsController,
    OpsController,
    AuthController,
  ],
  providers: [
    ExceptionsService,
    HealthService,
    RunsService,
    SettlementsService,
    AccountsService,
    RulesService,
    ExportsService,
    AuditService,
    MembersService,
    SavedViewsService,
    OpsService,
    AuthService,
    AuditInterceptor,
    { provide: APP_GUARD, useClass: ServiceTokenGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
