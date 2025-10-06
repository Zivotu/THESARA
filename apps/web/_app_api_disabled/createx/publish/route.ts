import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { runScript } from '../../../../lib/runScript';
import { ensureDir, pathSafeJoin, readJsonIfExists } from '../../../../lib/fsx';

const root = path.resolve(process.cwd(), '..', '..');
const analyzeScript = path.join(root, 'scripts', 'analyze.ts');
const manifestScript = path.join(root, 'scripts', 'manifest.ts');
const llmReviewScript = path.join(root, 'scripts', 'llmReview.ts');

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { entryPath, inlineCode, forceWizard, title, description } = body || {};
    if (!inlineCode && !entryPath) {
      return NextResponse.json({ ok: false, error: 'entryPath or inlineCode required' }, { status: 400 });
    }

    const id = randomUUID();
    const workdir = pathSafeJoin(root, 'build', 'api', id);
    await ensureDir(workdir);
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

    let entry: string;
    if (typeof inlineCode === 'string') {
      entry = pathSafeJoin(workdir, 'entry.tsx');
      fs.writeFileSync(entry, inlineCode, 'utf8');
    } else {
      entry = path.resolve(process.cwd(), String(entryPath));
      if (!fs.existsSync(entry)) {
        return NextResponse.json({ ok: false, error: 'Entry not found' }, { status: 400 });
      }
    }

    const logs: Record<string, string> = {};

    await writeProgress('analyze');
    let res = await runScript(process.execPath, ['-r', 'ts-node/register', analyzeScript, entry], { cwd: root });
    logs.analyze = res.stdout + res.stderr;
    if (res.code !== 0) return NextResponse.json({ ok: false, step: 'analyze', logs, stdout: res.stdout, stderr: res.stderr }, { status: 500 });

    await writeProgress('manifest');
    res = await runScript(process.execPath, ['-r', 'ts-node/register', manifestScript], { cwd: root });
    logs.manifest = res.stdout + res.stderr;
    if (res.code !== 0) return NextResponse.json({ ok: false, step: 'manifest', logs, stdout: res.stdout, stderr: res.stderr }, { status: 500 });

    const buildDir = pathSafeJoin(root, 'build');
    await ensureDir(buildDir);
    const metaPath = pathSafeJoin(buildDir, 'createx_meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({ title: title || '', description: description || '' }, null, 2));
    const manifestV1Path = pathSafeJoin(buildDir, 'manifest_v1.json');
    try {
      const manifestV1 = JSON.parse(fs.readFileSync(manifestV1Path, 'utf8'));
      if (title) manifestV1.title = title;
      fs.writeFileSync(manifestV1Path, JSON.stringify(manifestV1, null, 2));
    } catch {}

    await writeProgress('llm');
    res = await runScript(process.execPath, ['-r', 'ts-node/register', llmReviewScript], { cwd: root });
    const reviewPath = pathSafeJoin(buildDir, 'LLM_REVIEW.json');
    let rawReview = '';
    if (fs.existsSync(reviewPath)) {
      try {
        rawReview = fs.readFileSync(reviewPath, 'utf8');
      } catch {}
    }
    logs.llm = res.stdout + res.stderr + (rawReview ? `\n${rawReview}` : '');
    let llmInvalid = res.code !== 0;
    let errorCode: string | undefined;
    if (!fs.existsSync(reviewPath)) {
      llmInvalid = true;
    } else {
      try {
        const parsed = JSON.parse(rawReview);
        if (parsed?.errorCode) {
          llmInvalid = true;
          errorCode = String(parsed.errorCode);
        }
      } catch {
        llmInvalid = true;
      }
    }
    if (llmInvalid) {
      return NextResponse.json(
        { ok: false, step: 'llm', logs, error: 'LLM review failed', errorCode },
        { status: 500 },
      );
    }

    const review = (await readJsonIfExists<any>(reviewPath)) || {};

    const required = ['AST_SUMMARY.json', 'manifest_v1.json', 'transform_plan_v1.json', 'LLM_REVIEW.json'];
    const missing = required.filter((f) => !fs.existsSync(pathSafeJoin(buildDir, f)));
    if (missing.length) {
      const dir = fs.readdirSync(buildDir);
      return NextResponse.json({ ok: false, error: `missing ${missing.join(',')}`, logs, dir }, { status: 500 });
    }

    const rel = (p: string) => (fs.existsSync(pathSafeJoin(buildDir, p)) ? path.join('build', p) : null);
    const artifacts = {
      astSummary: rel('AST_SUMMARY.json'),
      manifestV1: rel('manifest_v1.json'),
      transformPlanV1: rel('transform_plan_v1.json'),
      llmReview: rel('LLM_REVIEW.json'),
    } as const;

    const wizardQuestions = review?.questions || [];
    const confidence = typeof review?.confidence === 'number' ? review.confidence : 1;
    if (forceWizard || wizardQuestions.length > 0 || confidence < 1) {
      await writeProgress('questions');
    } else {
      await writeProgress('done');
    }

    return NextResponse.json({
      ok: true,
      id,
      artifacts,
      logs,
      wizardQuestions,
      confidence,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'unhandled', message: String(err), stack: (err as any)?.stack },
      { status: 500 },
    );
  }
}
