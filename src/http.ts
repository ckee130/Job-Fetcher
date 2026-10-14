import { ProxyAgent, fetch as undiciFetch, type RequestInit } from "undici";
import { config } from "./config.js";

const dispatchers = new Map<string, ProxyAgent>();

function resolveProxyUrl(): string {
  return config.proxyUrl;
}

function getDispatcher(): ProxyAgent | undefined {
  const url = resolveProxyUrl();
  if (!url) return undefined;
  let agent = dispatchers.get(url);
  if (!agent) {
    agent = new ProxyAgent(url);
    dispatchers.set(url, agent);
  }
  return agent;
}

export async function httpRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = {
    "user-agent": config.userAgent,
    accept: "application/json, text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    ...(init.headers ?? {}),
  };

  try {
    const res = await undiciFetch(url, {
      ...init,
      headers,
      dispatcher: getDispatcher(),
      redirect: "follow",
    });
    return res as unknown as Response;
  } catch (err) {
    const cause =
      err instanceof Error && "cause" in err && err.cause instanceof Error
        ? err.cause.message
        : undefined;
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(cause ? `${base}: ${cause}` : base);
  }
}

export async function httpGet(url: string, init: RequestInit = {}): Promise<Response> {
  return httpRequest(url, init);
}

export async function httpPostJson(
  url: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return httpRequest(url, {
    ...init,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
