import { ProxyAgent, fetch as undiciFetch, type RequestInit } from "undici";
import { config } from "./config.js";

const dispatcher = config.proxyUrl ? new ProxyAgent(config.proxyUrl) : undefined;

export async function httpGet(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = {
    "user-agent": config.userAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    ...(init.headers ?? {}),
  };

  const res = await undiciFetch(url, {
    ...init,
    headers,
    dispatcher,
    redirect: "follow",
  });

  return res as unknown as Response;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
