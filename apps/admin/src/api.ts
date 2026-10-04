import { useEffect, useState } from 'react';
let csrf = '';
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const value = await response.json();
  if (!response.ok) throw new ApiError(response.status, value.error || 'Request failed');
  return value as T;
}
export function useResource<T>(path: string, interval = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const value = await api<T>(path, 'GET', undefined, controller.signal);
        if (!controller.signal.aborted) {
          setData(value);
          setError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load data');
      } finally {
        busy = false;
      }
    };
    void read();
    const timer = interval
      ? setInterval(() => {
          if (!document.hidden) void read();
        }, interval)
      : null;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, interval, generation]);
  return { data, error, refresh: () => setGeneration((value) => value + 1) };
}
