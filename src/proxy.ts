/** `http://user:pass@host:port` or `host:port:user:pass` */
export function parseProxyUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const parts = trimmed.split(":");
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return `http://${encodeURIComponent(user!)}:${encodeURIComponent(pass!)}@${host}:${port}`;
  }

  return trimmed;
}

export function proxyHostForLog(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `http://${url}`);
    return u.hostname + (u.port ? `:${u.port}` : "");
  } catch {
    return "(invalid proxy URL)";
  }
}
