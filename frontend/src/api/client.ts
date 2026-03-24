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
      throw new ApiRequestError(
        response.status,
        errorBody.error?.code ?? 'UNKNOWN',
        errorBody.error?.message ?? response.statusText
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

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
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

export function getConfig(): Promise<AppConfig> {
  return apiClient.get<AppConfig>('/config');
}

export function updateConfig(data: Partial<AppConfig>): Promise<AppConfig> {
  return apiClient.put<AppConfig>('/config', data);
}

export function validateConfig(data: Partial<AppConfig>): Promise<ValidationResult> {
  return apiClient.post<ValidationResult>('/config/validate', data);
}
