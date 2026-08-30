import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

const BASE = 'https://magic.dev/problems';

/**
 * Every non-2xx response takes the RFC 9457 shape and carries a trace identifier.
 *
 * That identifier costs nothing and turns a support ticket from "it broke" into a single query.
 * The detail field never carries an internal message for a 500: an unexpected failure is
 * reported as unexpected, and the specifics stay in the log where the trace id points.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const traceId = request.id ?? 'unknown';

    if (exception instanceof ZodError) {
      const errors: Record<string, string[]> = {};
      for (const issue of exception.issues) {
        const key = issue.path.join('.') || '_';
        errors[key] = [...(errors[key] ?? []), issue.message];
      }

      void reply.status(HttpStatus.BAD_REQUEST).type('application/problem+json').send({
        type: `${BASE}/validation-failed`,
        title: 'Request validation failed',
        status: HttpStatus.BAD_REQUEST,
        detail: 'One or more parameters did not match the expected shape.',
        instance: request.url,
        trace_id: traceId,
        errors,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);

      void reply
        .status(status)
        .type('application/problem+json')
        .send({
          type: `${BASE}/${slug(exception.name)}`,
          title: titleFor(status),
          status,
          detail: Array.isArray(detail) ? detail.join('; ') : detail,
          instance: request.url,
          trace_id: traceId,
        });
      return;
    }

    this.logger.error(
      { err: exception, traceId, url: request.url },
      'Unhandled exception escaped a request handler.',
    );

    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).type('application/problem+json').send({
      type: `${BASE}/internal-error`,
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'The request failed unexpectedly. Your data is unaffected.',
      instance: request.url,
      trace_id: traceId,
    });
  }
}

function slug(name: string): string {
  return name
    .replace(/Exception$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function titleFor(status: number): string {
  switch (status) {
    case 400: return 'Bad request';
    case 401: return 'Not authenticated';
    case 403: return 'Not permitted';
    case 404: return 'Not found';
    case 409: return 'Conflict';
    case 422: return 'Unprocessable';
    case 429: return 'Too many requests';
    default: return status >= 500 ? 'Server error' : 'Request failed';
  }
}
