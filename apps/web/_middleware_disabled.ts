import { NextResponse, type NextRequest } from 'next/server';

const SUPPORTED = new Set(['hr', 'en', 'de']);

function pickFromAcceptLanguage(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  try {
    const first = String(v).split(',')[0] || '';
    const norm = first.replace(/;.*/, '').trim().slice(0, 2).toLowerCase();
    return SUPPORTED.has(norm) ? norm : undefined;
  } catch {
    return undefined;
  }
}

// Ensure NEXT_LOCALE cookie is present on first visit; UI reads html[lang] and cookie
export default function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const has = req.cookies.get('NEXT_LOCALE')?.value;
  if (!has || !SUPPORTED.has(has)) {
    const detected = pickFromAcceptLanguage(req.headers.get('accept-language')) || 'hr';
    const oneYear = 60 * 60 * 24 * 365;
    res.cookies.set('NEXT_LOCALE', detected, {
      path: '/',
      maxAge: oneYear,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)']
};
