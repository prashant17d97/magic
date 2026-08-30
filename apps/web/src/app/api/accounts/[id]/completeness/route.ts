import type { NextRequest } from 'next/server';
import { proxyToApi } from '@/shared/lib/api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<Record<string, string>> }) {
  const params = await context.params;
  return proxyToApi(request, `/v1/accounts/${params.id}/completeness`);
}
