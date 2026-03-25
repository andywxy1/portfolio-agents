const BASE_URL = '/api';

class ApiClient {
  private apiKey: string;

  constructor() {
    this.apiKey = import.meta.env.VITE_API_KEY ?? '';
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 204) {
      return undefined as T;
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({
        error: { code: 'UNKNOWN', message: response.statusText },
      }));
      const errorObj = errorBody.error ?? {};
      throw new ApiRequestError(
        response.status,
        errorObj.code ?? 'UNKNOWN',
        errorObj.message ?? response.statusText,
        errorObj
      );
    }

    return response.json();
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  delete(path: string): Promise<void> {
    return this.request<void>(path, { method: 'DELETE' });
  }
}

export class ApiRequestError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const apiClient = new ApiClient();

// ---------------------------------------------------------------------------
// Config API helpers
// ---------------------------------------------------------------------------

import type { AppConfig, ConfigStatus, ValidationResult } from '../types';

export function getConfigStatus(): Promise<ConfigStatus> {
  return apiClient.get<ConfigStatus>('/config/status');
}

// Keys that should be parsed as numbers (backend may return them as strings)
const NUMERIC_CONFIG_KEYS = new Set(['weight_heavy_threshold', 'weight_medium_threshold']);

/**
 * Normalize config from backend: UPPERCASE keys -> lowercase, string numbers -> numbers.
 */
function normalizeConfigKeys(raw: Record<string, unknown>): AppConfig {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    if (NUMERIC_CONFIG_KEYS.has(lower) && typeof value === 'string') {
      const num = parseFloat(value);
      result[lower] = Number.isNaN(num) ? value : num;
    } else {
      result[lower] = value;
    }
  }
  return result as unknown as AppConfig;
}

export async function getConfig(): Promise<AppConfig> {
  const raw = await apiClient.get<Record<string, unknown>>('/config');
  return normalizeConfigKeys(raw);
}

export function updateConfig(data: Partial<AppConfig>): Promise<AppConfig> {
  return apiClient.put<AppConfig>('/config', data);
}

export function validateConfig(data: Partial<AppConfig>): Promise<ValidationResult> {
  return apiClient.post<ValidationResult>('/config/validate', data);
}
