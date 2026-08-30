import { NextResponse } from 'next/server';
import { serverEnv } from '@/shared/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const env = serverEnv();

  try {
    const response = await fetch(`${env.API_INTERNAL_URL}/health/ready`, {
      headers: { 'x-service-token': env.SERVICE_TOKEN },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return NextResponse.json({ status: 'unavailable', console: 'ok', api: 'unavailable' }, { status: 503 });
    }

    return NextResponse.json({ status: 'ok', console: 'ok', api: 'ok' });
  } catch {
    return NextResponse.json({ status: 'unavailable', console: 'ok', api: 'unreachable' }, { status: 503 });
  }
}
