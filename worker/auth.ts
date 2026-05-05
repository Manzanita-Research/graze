import { error, type IRequest } from "itty-router";

type RuntimeEnv = CloudflareBindings & {
  GRAZE_ACCESS_TOKEN?: string;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalRequest(request: Request): boolean {
  const host = new URL(request.url).hostname;
  return LOCAL_HOSTS.has(host);
}

export function getAccessToken(env: CloudflareBindings): string | undefined {
  const token = (env as RuntimeEnv).GRAZE_ACCESS_TOKEN;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

export function requireWorkerAccess(request: IRequest, env: CloudflareBindings) {
  const token = getAccessToken(env);
  if (!token) {
    if (isLocalRequest(request)) return null;
    return error(500, "GRAZE_ACCESS_TOKEN is required outside local dev");
  }

  const auth = request.headers.get("authorization") ?? "";
  if (!constantTimeEqual(auth, `Bearer ${token}`)) {
    return error(401, "Unauthorized");
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
