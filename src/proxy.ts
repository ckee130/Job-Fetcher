/** Hostname (+ port) for logs — never print credentials. */
export function proxyHostForLog(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `http://${url}`);
    return u.hostname + (u.port ? `:${u.port}` : "");
  } catch {
    return "(invalid proxy URL)";
  }
}
