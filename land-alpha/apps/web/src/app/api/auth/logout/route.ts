import { NextResponse } from 'next/server';
import { destroySession } from '@/server/auth';

export async function POST(request: Request): Promise<NextResponse> {
  await destroySession();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
