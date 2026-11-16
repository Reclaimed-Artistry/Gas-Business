const TOKEN_KEY = 'blueflame_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T = unknown>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { error: text || 'Unexpected response format' };
  }

  if (!res.ok) {
    throw new ApiError(
      String(json.error || json.message || `Request failed (${res.status})`),
      res.status,
      json
    );
  }

  return json as T;
}

export function subscribeToPlatformEvents(handlers: {
  onOrderUpdate?: (data: Record<string, unknown>) => void;
  onNotification?: (data: Record<string, unknown>) => void;
  onDispatcherLocation?: (data: Record<string, unknown>) => void;
  onDispatcherUpdate?: (data: Record<string, unknown>) => void;
}): () => void {
  const token = getStoredToken();
  if (!token) return () => {};
  const es = new EventSource(`/api/auth/events?token=${encodeURIComponent(token)}`);

  const safeParse = (raw: string) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  if (handlers.onOrderUpdate) {
    es.addEventListener('order_update', (e) => handlers.onOrderUpdate?.(safeParse((e as MessageEvent).data)));
  }
  if (handlers.onNotification) {
    es.addEventListener('notification', (e) => handlers.onNotification?.(safeParse((e as MessageEvent).data)));
  }
  if (handlers.onDispatcherLocation) {
    es.addEventListener('dispatcher_location', (e) =>
      handlers.onDispatcherLocation?.(safeParse((e as MessageEvent).data))
    );
  }
  if (handlers.onDispatcherUpdate) {
    es.addEventListener('dispatcher_update', (e) =>
      handlers.onDispatcherUpdate?.(safeParse((e as MessageEvent).data))
    );
  }

  return () => {
    es.close();
  };
}
