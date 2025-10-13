
export type LlmRisk = {
  id?: string;
  severity: 'low' | 'med' | 'high' | 'critical';
  title: string;
  detail?: string;
};

export type LlmQuestion = { q: string; where?: string };

export type LlmReport = {
  summary: string;
  publishRecommendation: 'approve' | 'review' | 'reject';
  confidence: number;
  risks: LlmRisk[];
  questions: LlmQuestion[];
  suggested_manifest_patch?: Record<string, any>;
  suggested_transform_flags?: Record<string, any>;
};

export type LlmWrapper = {
  status: 'not_ready' | 'generating' | 'complete' | 'error';
  provider: string;
  model: string;
  createdAt: string;
  error?: { code: string; detail?: string };
  data?: LlmReport;
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function normalizeLlmReport(
  raw: any,
  defaults: { provider: string; model: string },
): LlmWrapper {
  const provider = raw?.provider || defaults.provider;
  const model = raw?.model || defaults.model;
  const rawStatus = raw?.status;
  const createdAt = raw?.createdAt || new Date().toISOString();

  let status: LlmWrapper['status'];
  if (raw?.skipped || rawStatus === 'pending' || rawStatus === 'skipped') {
    status = 'not_ready';
  } else if (rawStatus === 'generating') {
    status = 'generating';
  } else if (rawStatus === 'error') {
    status = 'error';
  } else if (rawStatus === 'not_ready') {
    status = 'not_ready';
  } else {
    status = 'complete';
  }

  let data: LlmReport | undefined;
  let error: { code: string; detail?: string } | undefined;

  if (status === 'complete') {
    const summary = typeof raw?.summary === 'string' ? raw.summary : '';
    const publishRecommendation = ['approve', 'review', 'reject'].includes(
      raw?.publishRecommendation,
    )
      ? raw.publishRecommendation
      : 'review';
    const confidence = clamp01(Number(raw?.confidence) || 0);
    const risks = Array.isArray(raw?.risks)
      ? raw.risks.map((r: any) => ({
          id: r?.id,
          severity: ['low', 'med', 'high', 'critical'].includes(r?.severity)
            ? r.severity
            : 'low',
          title: String(r?.title ?? ''),
          detail: r?.detail ? String(r.detail) : undefined,
        }))
      : [];
    const questions = Array.isArray(raw?.questions)
      ? raw.questions.map((q: any) => ({
          q: String(q?.q ?? ''),
          where: q?.where ? String(q.where) : undefined,
        }))
      : [];
    const suggested_manifest_patch =
      typeof raw?.suggested_manifest_patch === 'object'
        ? raw.suggested_manifest_patch
        : undefined;
    const suggested_transform_flags =
      typeof raw?.suggested_transform_flags === 'object'
        ? raw.suggested_transform_flags
        : undefined;
    data = {
      summary,
      publishRecommendation,
      confidence,
      risks,
      questions,
      suggested_manifest_patch,
      suggested_transform_flags,
    };
  } else if (raw?.error || raw?.reason) {
    error = {
      code: String(raw.error || raw.reason),
      detail: raw?.detail ? String(raw.detail) : undefined,
    };
  }

  return {
    status,
    provider,
    model,
    createdAt,
    ...(error ? { error } : {}),
    ...(data ? { data } : {}),
  };
}
