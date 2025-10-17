import { readArtifact, hasArtifact } from './utils/artifacts.js';
import Ajv from 'ajv';
import { normalizeLlmReport, type LlmWrapper } from './lib/llm.js';
import { AppError } from './lib/errors.js';

const {
  OPENAI_API_KEY,
  LLM_MODEL,
  LLM_API_URL,
  LLM_PROVIDER,
  LLM_TIMEOUT_MS,
  LLM_MAX_RETRY,
} = process.env as Record<string, string | undefined>;

const TIMEOUT_MS = Number(LLM_TIMEOUT_MS || '30000');
const MAX_RETRY = Number(LLM_MAX_RETRY || '5');

function parseContent(content: string): any | null {
  // If the model wrapped the response in a markdown code block, extract it.
  const blockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const cleaned = (blockMatch ? blockMatch[1] : content).trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  // Fallback: try to locate the first JSON object in the text.
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}

export async function runLlmReviewForBuild(
  buildId: string,
  opts?: { provider?: string; model?: string },
): Promise<LlmWrapper> {
  const provider = opts?.provider || LLM_PROVIDER || 'openai';
  const model = opts?.model || LLM_MODEL || 'gpt-4o-mini';
  if (!OPENAI_API_KEY) {
    throw new AppError('LLM_MISSING_API_KEY');
  }
  const required = [
    { path: 'build/AST_SUMMARY.json', label: 'AST_SUMMARY.json' },
    { path: 'build/manifest_v1.json', label: 'manifest_v1.json' },
    { path: 'build/transform_plan_v1.json', label: 'transform_plan_v1.json' },
  ];
  const missing: string[] = [];
  for (const r of required) {
    if (!(await hasArtifact(buildId, r.path))) missing.push(r.label);
  }
  if (missing.length) {
    throw new AppError('MISSING_ARTIFACT', `Missing artifacts: ${missing.join(',')}`);
  }
  const ast = await readArtifact(buildId, 'build/AST_SUMMARY.json');
  const manifest = await readArtifact(buildId, 'build/manifest_v1.json');
  const plan = await readArtifact(buildId, 'build/transform_plan_v1.json');
  let imports: string = 'null';
  try {
    imports = await readArtifact(buildId, 'build/imports_v1.json');
  } catch {}

  const systemMsg =
    'You are a code safety and quality reviewer. Reply with a single valid JSON object only. Schema must be {"summary": string, "publishRecommendation": approve|review|reject, "confidence": number 0..1, "risks": {id?: string, severity: low|med|high|critical, title: string, detail?: string}[], "questions": {q: string, where?: string}[], "suggested_manifest_patch": object, "suggested_transform_flags": object}.' +
    ' The suggested_manifest_patch should include explicit recommendations for permissions policy and networking, e.g. {"permissionsPolicy": {"camera": boolean, "microphone": boolean, "geolocation": boolean, "clipboardRead": boolean, "clipboardWrite": boolean}, "networkPolicy": "NO_NET|MEDIA_ONLY|OPEN_NET", "networkDomains": string[]}.' +
    ' Base your decisions on the attached AST summary, build manifest and transform plan. Provide realistic risks explaining why specific permissions or network access are necessary. Do not include any extra text or formatting.';
  const userBase = `Review the app bundle.\nAST_SUMMARY: ${ast}\nMANIFEST_V1: ${manifest}\nTRANSFORM_PLAN_V1: ${plan}\nIMPORTS_V1: ${imports}`;
  const base = (LLM_API_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

  async function request(): Promise<Response> {
    let attempt = 0;
    let delay = 1000;
    while (true) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: userBase },
            ],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) return res;
        if (attempt < MAX_RETRY && (res.status === 429 || res.status >= 500)) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        if (attempt < MAX_RETRY) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
          continue;
        }
        throw err;
      }
    }
  }

  let res: Response;
  try {
    res = await request();
  } catch (err) {
    throw new AppError('LLM_UNREACHABLE', String(err));
  }
  if (!res.ok) {
    throw new AppError(`http_${res.status}`, await res.text());
  }
  const txt = await res.text();
  let content = '';
  try {
    const j = JSON.parse(txt);
    content = j.choices?.[0]?.message?.content || '';
  } catch {
    content = txt;
  }
  const parsed = parseContent(content);

  const schema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      publishRecommendation: {
        type: 'string',
        enum: ['approve', 'review', 'reject'],
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      risks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            severity: {
              type: 'string',
              enum: ['low', 'med', 'high', 'critical'],
            },
            title: { type: 'string' },
            detail: { type: 'string' },
          },
          required: ['severity', 'title'],
          additionalProperties: false,
        },
      },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            where: { type: 'string' },
          },
          required: ['q'],
          additionalProperties: false,
        },
      },
      suggested_manifest_patch: { type: 'object' },
      suggested_transform_flags: { type: 'object' },
    },
    required: [
      'summary',
      'publishRecommendation',
      'confidence',
      'risks',
      'questions',
      'suggested_manifest_patch',
      'suggested_transform_flags',
    ],
    additionalProperties: false,
  } as const;
  const ajv = new (Ajv as any)();
  const validate = ajv.compile(schema);

  if (!parsed || !validate(parsed)) {
    console.warn('LLM returned invalid JSON', content);
    throw new AppError('LLM_INVALID_JSON', JSON.stringify(validate.errors));
  }
  const report = normalizeLlmReport(
    {
      provider,
      model,
      summary: parsed.summary,
      publishRecommendation: parsed.publishRecommendation,
      confidence: parsed.confidence,
      risks: parsed.risks,
      questions: parsed.questions,
      suggested_manifest_patch: parsed.suggested_manifest_patch,
      suggested_transform_flags: parsed.suggested_transform_flags,
      status: 'complete',
    },
    { provider, model },
  );
  return report;
}

// Only run the CLI when explicitly opted in via env to avoid
// accidental execution in bundled server builds.
if (process.env.LLM_CLI === '1' && process.argv[1] === __filename) {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: node llmReview.js <buildId>');
    process.exit(1);
  }
  runLlmReviewForBuild(id)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
