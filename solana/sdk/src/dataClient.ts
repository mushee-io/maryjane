export type DataClientFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export type RealtimeSocket = {
  close(): void;
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: any) => void,
  ): void;
};

export type RealtimeSocketFactory = (url: string) => RealtimeSocket;

export type MarketListParams = {
  q?: string;
  status?: string;
  sort?: "volume" | "liquidity" | "newest" | "ending";
  limit?: number;
  offset?: number;
};

export class MiladyDataClient {
  constructor(
    private readonly baseUrl = "",
    private readonly fetcher: DataClientFetch = globalThis.fetch as DataClientFetch,
  ) {
    if (!this.fetcher) {
      throw new Error("A fetch implementation is required");
    }
  }

  private url(path: string, params?: Record<string, string | number | undefined>) {
    const base = this.baseUrl.replace(/\/$/, "");
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const query = search.toString();
    return `${base}${path}${query ? `?${query}` : ""}`;
  }

  private async get<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const response = await this.fetcher(this.url(path, params));
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || `Request failed with status ${response.status}`);
    }
    return data as T;
  }

  indexerStatus<T = any>() {
    return this.get<T>("/api/v1/indexer/status");
  }

  analytics<T = any>() {
    return this.get<T>("/api/v1/analytics/protocol");
  }

  listMarkets<T = any>(params: MarketListParams = {}) {
    return this.get<T>("/api/v1/markets", params);
  }

  market<T = any>(address: string) {
    return this.get<T>(`/api/v1/markets/${encodeURIComponent(address)}`);
  }

  marketChart<T = any>(
    address: string,
    range: "1h" | "24h" | "7d" | "30d" | "all" = "24h",
  ) {
    return this.get<T>(
      `/api/v1/markets/${encodeURIComponent(address)}/chart`,
      { range },
    );
  }

  betaRounds<T = any>(limit = 100) {
    return this.get<T>("/api/v1/beta/rounds", { limit });
  }

  betaChart<T = any>(
    address: string,
    range: "1h" | "24h" | "7d" | "30d" | "all" = "24h",
  ) {
    return this.get<T>(
      `/api/v1/beta/${encodeURIComponent(address)}/chart`,
      { range },
    );
  }

  events<T = any>(params: {
    market?: string;
    round?: string;
    type?: string;
    limit?: number;
  } = {}) {
    return this.get<T>("/api/v1/events", params);
  }

  connectRealtime(
    onUpdate: (payload: any) => void,
    socketFactory?: RealtimeSocketFactory,
  ) {
    const factory =
      socketFactory ??
      ((url: string) => {
        const ctor = (globalThis as any).WebSocket;
        if (!ctor) throw new Error("WebSocket is not available in this environment");
        return new ctor(url) as RealtimeSocket;
      });

    const wsBase = this.baseUrl
      ? this.baseUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:")
      : (() => {
          const location = (globalThis as any).location;
          if (!location) {
            throw new Error("baseUrl is required outside a browser");
          }
          return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
        })();

    const socket = factory(`${wsBase.replace(/\/$/, "")}/ws/markets`);
    socket.addEventListener("message", (event) => {
      try {
        const raw =
          typeof event?.data === "string"
            ? event.data
            : String(event?.data ?? "");
        onUpdate(JSON.parse(raw));
      } catch {
        // Ignore malformed realtime frames.
      }
    });
    return socket;
  }
}
