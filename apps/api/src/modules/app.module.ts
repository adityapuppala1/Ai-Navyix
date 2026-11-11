import{Module,Controller,Get}from'@nestjs/common';
import{ConfigModule}from'@nestjs/config';
@Controller('health')
class HealthController {
 @Get() health(){return{status:'ok',service:'navyix-api',mode:'foundation'};}
 @Get('ready') ready(){return{status:'foundation-only',authenticatedBusinessApis:false};}
}
@Module({imports:[ConfigModule.forRoot({isGlobal:true,envFilePath:['../../.env','.env']})],controllers:[HealthController]})export class AppModule{}
