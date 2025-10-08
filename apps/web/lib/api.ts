import { joinUrl } from './url';
import { API_URL } from './config';
import { getApiBase, INTERNAL_API_URL } from './apiBase';

function getBase() {
  if (typeof window === 'undefined') {
    return process.env.LOCAL_API_URL || INTERNAL_API_URL || API_URL;
  }
  return getApiBase();
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface ApiOptions extends Omit<RequestInit, 'body'> {
  method?: string;
  body?: any;
  auth?: boolean;
}

async function apiFetchRaw(path: string, opts: ApiOptions = {}): Promise<Response> {
  const { method = 'GET', headers = {}, body, auth: useAuth, signal } = opts;
  const urlPath = '/' + path.replace(/^\/+/, '');
  const url = joinUrl(getBase(), urlPath);

  const hdrs: Record<string, string> = {
    ...(headers as Record<string, string>),
  };
  // Attach preferred language from document for server-side localization
  if (typeof window !== 'undefined' && !hdrs['Accept-Language']) {
    const lang = document.documentElement?.lang;
    if (lang) hdrs['Accept-Language'] = lang;
  }

  if (typeof window !== 'undefined') {
    try {
      const { auth } = await import('./firebase');
      const currentUser = auth?.currentUser;
      if (currentUser) {
        const forceRefresh = useAuth === true;
        const token = await currentUser.getIdToken(forceRefresh);
        if (token && !('Authorization' in hdrs)) hdrs['Authorization'] = `Bearer ${token}`;
      }
    } catch {}
    if (!('Authorization' in hdrs)) {
      try {
        const urlToken = new URL(window.location.href).searchParams.get('token');
        if (urlToken) hdrs['Authorization'] = `Bearer ${urlToken}`;
      } catch {}
    }
  }

  const isFormData =
    typeof FormData !== 'undefined' && body instanceof FormData;
  const isBlob =
    typeof Blob !== 'undefined' && body instanceof Blob;
  const isUrlEncoded =
    typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams;
  const isArrayBuffer =
    typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer;
  const isView = typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body as any);
  const isReadable =
    typeof ReadableStream !== 'undefined' && body instanceof ReadableStream;
  const isBinaryBody = isFormData || isBlob || isUrlEncoded || isArrayBuffer || isView || isReadable;

  if (body !== undefined && !hdrs['Content-Type'] && !isBinaryBody) {
    hdrs['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort());
  }
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: hdrs,
      body:
        body === undefined
          ? undefined
          : isBinaryBody
          ? (body as BodyInit)
          : JSON.stringify(body),
      signal: signal || controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await apiFetchRaw(path, opts);

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!res.ok) {
    const msg = data?.message || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data?.code);
  }
  return data as T;
}

export function apiGet<T = unknown>(path: string, opts: ApiOptions = {}) {
  return apiFetch<T>(path, { ...opts, method: opts.method || 'GET' });
}

export function apiPost<T = unknown>(path: string, body?: any, opts: ApiOptions = {}) {
  return apiFetch<T>(path, { ...opts, method: opts.method || 'POST', body });
}

export function apiPut<T = unknown>(path: string, body?: any, opts: ApiOptions = {}) {
  return apiFetch<T>(path, { ...opts, method: opts.method || 'PUT', body });
}

export function apiPatch<T = unknown>(path: string, body?: any, opts: ApiOptions = {}) {
  return apiFetch<T>(path, { ...opts, method: opts.method || 'PATCH', body });
}

export function apiDelete<T = unknown>(path: string, opts: ApiOptions = {}) {
  return apiFetch<T>(path, { ...opts, method: opts.method || 'DELETE' });
}

export function apiGetRaw(path: string, opts: ApiOptions = {}) {
  return apiFetchRaw(path, { ...opts, method: opts.method || 'GET' });
}

export function apiPostRaw(path: string, body?: any, opts: ApiOptions = {}) {
  return apiFetchRaw(path, { ...opts, method: opts.method || 'POST', body });
}

export function apiPutRaw(path: string, body?: any, opts: ApiOptions = {}) {
  return apiFetchRaw(path, { ...opts, method: opts.method || 'PUT', body });
}

export function apiPatchRaw(path: string, body?: any, opts: ApiOptions = {}) {
  return apiFetchRaw(path, { ...opts, method: opts.method || 'PATCH', body });
}

export function apiDeleteRaw(path: string, opts: ApiOptions = {}) {
  return apiFetchRaw(path, { ...opts, method: opts.method || 'DELETE' });
}

export const apiAuthedPost = <T = unknown>(path: string, body?: any) =>
  apiPost<T>(path, body, { auth: true });


