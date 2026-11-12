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
export class PrismaTeamRepository { constructor(prisma: unknown); assertRuntime(): Promise<void>; }
export class TeamService { constructor(repository: PrismaTeamRepository); }
export function createHttpHandler(options: {
  service: WorkflowService;
  authenticate: (authorization: string | undefined) => Promise<Principal>;
  onError?: (event: { requestId: string; code: string }) => void;
  teamService?: TeamService | null;
  githubService?: GitHubEvidenceService | null;
}): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export interface GitHubConnection {
  readonly orgId: string; readonly projectId: string; readonly repository: string; readonly repositoryId: number;
  readonly workflowIds: readonly number[]; readonly requiredJobs: readonly string[]; readonly events: readonly string[]; readonly tokenEnv: string;
}
export function githubConnections(env: Record<string, string | undefined>): readonly GitHubConnection[];
export class GitHubEvidenceService { constructor(workflow: WorkflowService, connections: readonly GitHubConnection[]); }
