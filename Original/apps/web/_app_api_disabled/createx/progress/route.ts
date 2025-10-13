import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { pathSafeJoin, readJsonIfExists } from '../../../../lib/fsx';

export const runtime = 'nodejs';

const root = path.resolve(process.cwd(), '..', '..');

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ ok: true, progress: { step: null } });
    const progressPath = pathSafeJoin(root, 'build', 'api', id, 'progress.json');
    const data = await readJsonIfExists<{ step: string }>(progressPath);
    return NextResponse.json({ ok: true, progress: { step: data?.step ?? null } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'unhandled', message: String(err), stack: (err as any)?.stack },
      { status: 500 },
    );
  }
}

