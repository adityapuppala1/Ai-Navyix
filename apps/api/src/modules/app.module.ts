import{Module,Controller,Get}from'@nestjs/common';
@Controller('health')
class HealthController {
 @Get() health(){return{status:'ok',service:'navyix-api',mode:'foundation'};}
 @Get('ready') ready(){return{status:'foundation-only',authenticatedBusinessApis:false};}
}
@Module({controllers:[HealthController]})export class AppModule{}
