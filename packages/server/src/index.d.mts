import type { IncomingMessage, ServerResponse } from 'node:http';
export interface Principal { issuer: string; subject: string }
export interface AuthConfig { profile: string; issuer: string; jwksUrl: string; audience?: string; clientId?: string; requiredScope: string }
export function authConfig(env: Record<string, string | undefined>): AuthConfig;
export function createAuthenticator(config: AuthConfig, jose: unknown): (authorization: string | undefined) => Promise<Principal>;
export class PrismaWorkflowRepository {
  constructor(prisma: unknown);
  assertRuntime(): Promise<void>;
}
export class WorkflowService { constructor(repository: PrismaWorkflowRepository, options?: { clock?: () => number }); }
export function createHttpHandler(options: {
  service: WorkflowService;
  authenticate: (authorization: string | undefined) => Promise<Principal>;
  onError?: (event: { requestId: string; code: string }) => void;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
