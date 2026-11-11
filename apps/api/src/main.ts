import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule, RuntimeStatus } from './modules/app.module';

async function bootstrap(): Promise<void> {
  // The bounded workflow HTTP handler consumes its own JSON body.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  const status = app.get(RuntimeStatus);
  const enabled = process.env.NAVYIX_API_ENABLED;
  if (enabled && !['true', 'false'].includes(enabled)) throw new Error('NAVYIX_API_ENABLED must be true or false.');
  let disconnect: (() => Promise<void>) | undefined;
  try {
    if (enabled === 'true') {
      const [{ PrismaClient }, jose, runtime] = await Promise.all([
        import('@prisma/client'), import('jose'), import('@navyix/server')
      ]);
      const config = runtime.authConfig(process.env);
      const database = new PrismaClient();
      disconnect = () => database.$disconnect();
      await database.$connect();
      const repository = new runtime.PrismaWorkflowRepository(database);
      await repository.assertRuntime();
      app.use('/v1/orgs', runtime.createHttpHandler({
        service: new runtime.WorkflowService(repository),
        authenticate: runtime.createAuthenticator(config, jose),
        onError: event => console.error(JSON.stringify(event))
      }));
      status.enabled = true;
      status.check = async () => { await database.$queryRaw`SELECT 1`; };
      app.getHttpServer().once('close', () => { void database.$disconnect(); });
    }
    // No wildcard CORS, cookie authentication, role headers or development auth bypass.
    const server = app.getHttpServer();
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    server.maxHeadersCount = 64;
    const port = Number(process.env.API_PORT || 4000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT.');
    await app.listen(port, process.env.API_HOST || '127.0.0.1');
  } catch (error) {
    await disconnect?.();
    await app.close();
    throw error;
  }
}
void bootstrap().catch(() => {
  // Database connection errors can contain credentials; do not print raw startup errors.
  console.error('Navyix API startup failed. Check database role/migrations and OIDC settings against docs/SERVER_WORKFLOW.md.');
  process.exitCode = 1;
});
