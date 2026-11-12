export function browserConfig(env: Record<string, string | undefined>): Record<string, any>;
export function browserHandler(options: { config: Record<string, any>; store: PostgresSessions; oidc: ReturnType<typeof oidcClient>; fetcher?: typeof fetch; clock?: () => number }): (request: Request) => Promise<Response>;
export function oidcClient(config: Record<string, any>, jose: typeof import('jose'), fetcher?: typeof fetch, clock?: () => number): { exchange(code: string, verifier: string, nonce: string): Promise<{ accessToken: string; issuer: string; subject: string; expiresAt: number }> };
export class PostgresSessions {
  constructor(pool: { query(text: string, values?: any[]): Promise<{ rows: any[] }> });
  assertSafe(): Promise<void>;
  putLogin(id: string, sealed: string, expiresAt: number): Promise<void>;
  consumeLogin(id: string): Promise<{ sealed: string; expiresAt: number } | null>;
  putSession(id: string, sealed: string, expiresAt: number, idleUntil: number): Promise<void>;
  getSession(id: string, now: number, idleSeconds: number): Promise<{ sealed: string; expiresAt: number } | null>;
  deleteSession(id: string): Promise<void>;
  cleanup(now?: number): Promise<void>;
}
