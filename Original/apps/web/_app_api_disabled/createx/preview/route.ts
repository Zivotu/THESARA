import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { ensureDir, pathSafeJoin } from '../../../../lib/fsx';

export const runtime = 'nodejs';

// Use the web app's public directory so the preview can be served by Next.js
// directly under `/build/api/<id>/preview.html`.
const root = process.cwd();

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

    const workdir = pathSafeJoin(root, 'public', 'build', 'api', String(id));
    await ensureDir(workdir);
    const progressPath = pathSafeJoin(workdir, 'progress.json');
    const previewPath = pathSafeJoin(workdir, 'preview.html');

    // Create a very simple HTML preview. Real implementation could run a build script.
    const html = `<html><body><h1>Preview for ${id}</h1></body></html>`;
    fs.writeFileSync(previewPath, html, 'utf8');

    // Update progress to preview stage so the UI can advance.
    try {
      fs.writeFileSync(progressPath, JSON.stringify({ step: 'preview' }, null, 2));
    } catch {}

    const previewUrl = `/build/api/${id}/preview.html`;
    return NextResponse.json({ ok: true, previewUrl });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'unhandled', message: String(err), stack: (err as any)?.stack },
      { status: 500 },
    );
  }
}
