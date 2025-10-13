import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { runScript } from '../../../../lib/runScript';
import { ensureDir, pathSafeJoin, readJsonIfExists } from '../../../../lib/fsx';
import { API_URL } from '../../../../lib/config';
import { joinUrl } from '../../../../lib/url';
import path from 'path';

const root = path.resolve(process.cwd(), '..', '..');
const transformScript = path.join(root, 'scripts', 'transform.ts');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { id, answers, title, description } = body || {};
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

    try {
      const authHeader = req.headers.get('authorization') || '';
      const quotaRes = await fetch(joinUrl(API_URL, '/quota'), {
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
          cookie: req.headers.get('cookie') || '',
        },
      });
      const quota = await quotaRes.json();
      if (!quotaRes.ok || (quota.quotaRemaining ?? 0) <= 0) {
        return NextResponse.json(
          {
            ok: false,
            error: 'plan_limit',
            message:
              'Free plan allows up to 5 apps. Upgrade at /pro for unlimited publishing.',
            quotaRemaining: quota.quotaRemaining ?? 0,
          },
          { status: 400 }
        );
      }
    } catch {}

    const buildDir = pathSafeJoin(root, 'build');
    await ensureDir(buildDir);
    fs.writeFileSync(pathSafeJoin(buildDir, 'wizard_answers.json'), JSON.stringify(answers || {}, null, 2));
    const metaPath = pathSafeJoin(buildDir, 'createx_meta.json');
    const prevMeta = (await readJsonIfExists<any>(metaPath)) || {};
    const nextMeta = {
      title: title ?? prevMeta.title ?? '',
      description: description ?? prevMeta.description ?? '',
    };
    fs.writeFileSync(metaPath, JSON.stringify(nextMeta, null, 2));

    const workdir = pathSafeJoin(root, 'build', 'api', String(id));
    const progressPath = pathSafeJoin(workdir, 'progress.json');
    const writeProgress = async (step: string) => {
      try {
        await ensureDir(workdir);
        fs.writeFileSync(progressPath, JSON.stringify({ step }, null, 2));
      } catch {
        try {
          await ensureDir(workdir);
          fs.writeFileSync(progressPath, JSON.stringify({ step }, null, 2));
        } catch {}
      }
    };

    const logs: Record<string, string> = {};

    await writeProgress('transform');
    const res = await runScript(process.execPath, ['-r', 'ts-node/register', transformScript], { cwd: root });
    logs.transform = res.stdout + res.stderr;
    if (res.code !== 0)
      return NextResponse.json({ ok: false, step: 'transform', logs, stdout: res.stdout, stderr: res.stderr }, { status: 500 });

    const required = ['manifest_v2.json', 'diagnostics.json', 'diff.txt', 'transformed.tsx'];
    const missing = required.filter((f) => !fs.existsSync(pathSafeJoin(buildDir, f)));
    if (missing.length) {
      const diagnostics = await readJsonIfExists<any>(pathSafeJoin(buildDir, 'diagnostics.json'));
      const dir = fs.readdirSync(buildDir);
      return NextResponse.json({ ok: false, error: `missing ${missing.join(',')}`, logs, diagnostics, dir }, { status: 500 });
    }

    const rel = (p: string) => (fs.existsSync(pathSafeJoin(buildDir, p)) ? path.join('build', p) : null);
    const diffText = fs.readFileSync(pathSafeJoin(buildDir, 'diff.txt'), 'utf8');

    const artifacts = {
      manifestV2: rel('manifest_v2.json'),
      diagnostics: rel('diagnostics.json'),
      diff: diffText,
      transformed: rel('transformed.tsx'),
    } as const;

    let meta = nextMeta;
    try {
      meta = (await readJsonIfExists<any>(metaPath)) || nextMeta;
      const manifestV2Path = pathSafeJoin(buildDir, 'manifest_v2.json');
      if (fs.existsSync(manifestV2Path)) {
        const manifestV2 = JSON.parse(fs.readFileSync(manifestV2Path, 'utf8'));
        manifestV2.title = meta.title || manifestV2.title;
        if (meta.description) manifestV2.description = meta.description;
        fs.writeFileSync(manifestV2Path, JSON.stringify(manifestV2, null, 2));
      }
    } catch {}

    // Move to the preview stage; the preview route will finalize the job.
    await writeProgress('preview');
    return NextResponse.json({ ok: true, artifacts, logs, id, title: meta.title, description: meta.description });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'unhandled', message: String(err), stack: (err as any)?.stack },
      { status: 500 },
    );
  }
}
