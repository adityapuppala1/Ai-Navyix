import { Module, Controller, Get, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
@Injectable()
export class RuntimeStatus {
  enabled = false;
  check?: () => Promise<void>;
}
@Controller('health')
class HealthController {
  constructor(private readonly runtime: RuntimeStatus) {}
  @Get()
  health() { return { status: 'ok', service: 'navyix-api', mode: this.runtime.enabled ? 'workflow-development' : 'foundation' }; }
  @Get('ready')
  async ready() {
    if (!this.runtime.enabled) throw new ServiceUnavailableException({ status: 'workflow-disabled', authenticatedBusinessApis: false });
    try { await this.runtime.check?.(); }
    catch { throw new ServiceUnavailableException({ status: 'database-unavailable' }); }
    return { status: 'development-enabled', authenticatedBusinessApis: true, productionValidated: false };
  }
}
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] })],
  controllers: [HealthController], providers: [RuntimeStatus]
})
export class AppModule {}
