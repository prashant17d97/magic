import type { NextRequest } from 'next/server';
import { proxyToApi } from '@/shared/lib/api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return proxyToApi(request, '/v1/saved-views');
}

export async function POST(request: NextRequest) {
  return proxyToApi(request, '/v1/saved-views');
}
