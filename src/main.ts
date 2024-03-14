import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {Logger, ValidationPipe} from "@nestjs/common";
import {config} from "dotenv";

const logger = new Logger('MAIN');

async function bootstrap() {
  config()
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
      }),
  );
  app.useLogger(new Logger());
  app.enableCors({
    origin: '*' , // Allow requests from this origin
    methods: ['GET', 'POST'], // Allow only specified HTTP methods
    preflightContinue: false,
    allowedHeaders: ['Content-Type', 'Authorization'], // Allow only specified headers
    credentials: true,
  });

  app.use('/healthz', (req, res) => {
    const message = 'healthz OK';
    logger.log(message);
    res.send(message);
  });
  await app.listen(process.env.PORT || 3500);
}
bootstrap();
