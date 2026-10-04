import type {
  ShutterEncryptionData,
  ShutterNetwork,
  ShutterTimeIdentity,
} from "./types";

const BASE_URLS: Record<ShutterNetwork, string> = {
  chiado: "https://shutter-api.chiado.staging.shutter.network/api",
  gnosis: "https://shutter-api.shutter.network/api",
};

type ShutterApiClientOptions = {
  network?: ShutterNetwork;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type RawIdentityResponse = {
  eon: number;
  eon_key: string;
  identity: string;
  identity_prefix: string;
  epoch_id?: string;
};

function normalizeIdentity(
  raw: RawIdentityResponse,
  decryptionTimestamp: number,
): ShutterTimeIdentity {
  return {
    eon: raw.eon,
    eonKey: raw.eon_key,
    identity: raw.identity,
    identityPrefix: raw.identity_prefix,
    epochId: raw.epoch_id,
    decryptionTimestamp,
  };
}

function normalizeEncryptionData(raw: RawIdentityResponse): ShutterEncryptionData {
  return {
    eon: raw.eon,
    eonKey: raw.eon_key,
    identity: raw.identity,
    identityPrefix: raw.identity_prefix,
    epochId: raw.epoch_id,
  };
}

export class ShutterApiClient {
  readonly network: ShutterNetwork;
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ShutterApiClientOptions = {}) {
    this.network = options.network ?? "chiado";
    this.baseUrl = BASE_URLS[this.network];
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    if (init?.body) headers.set("content-type", "application/json");
    if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Shutter API ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
      );
    }

    return response.json() as Promise<T>;
  }

  async registerTimeIdentity(params: {
    decryptionTimestamp: number;
    identityPrefix: string;
  }): Promise<ShutterTimeIdentity> {
    if (!Number.isInteger(params.decryptionTimestamp) || params.decryptionTimestamp <= 0) {
      throw new Error("decryptionTimestamp must be a positive Unix timestamp.");
    }

    const raw = await this.request<RawIdentityResponse>("/time/register_identity", {
      method: "POST",
      body: JSON.stringify({
        decryptionTimestamp: params.decryptionTimestamp,
        identityPrefix: params.identityPrefix,
      }),
    });

    return normalizeIdentity(raw, params.decryptionTimestamp);
  }

  async getTimeEncryptionData(params: {
    address: string;
    identityPrefix: string;
  }): Promise<ShutterEncryptionData> {
    const query = new URLSearchParams({
      address: params.address,
      identityPrefix: params.identityPrefix,
    });

    const raw = await this.request<RawIdentityResponse>(
      `/time/get_data_for_encryption?${query.toString()}`,
    );

    return normalizeEncryptionData(raw);
  }

  async getTimeDecryptionKey(identity: string): Promise<string> {
    const query = new URLSearchParams({ identity });
    const raw = await this.request<Record<string, unknown>>(
      `/time/get_decryption_key?${query.toString()}`,
    );

    const key =
      raw.decryption_key ??
      raw.decryptionKey ??
      raw.key ??
      raw.epoch_secret_key ??
      raw.epochSecretKey;

    if (typeof key !== "string" || !key.startsWith("0x")) {
      throw new Error("Shutter API returned an unexpected decryption-key payload.");
    }

    return key;
  }
}

export function randomIdentityPrefix(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
