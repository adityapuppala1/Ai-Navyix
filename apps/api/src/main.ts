import 'reflect-metadata';
import{NestFactory}from'@nestjs/core';import{ValidationPipe}from'@nestjs/common';import{AppModule}from'./modules/app.module';
async function bootstrap():Promise<void>{
 const app=await NestFactory.create(AppModule,{bufferLogs:true});
 app.setGlobalPrefix('v1');
 app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
 // No wildcard CORS or unauthenticated tenant routes.
 await app.listen(Number(process.env.API_PORT??4000),'0.0.0.0');
}
void bootstrap();
