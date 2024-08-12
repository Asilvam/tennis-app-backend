import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CourtModule } from './court/court.module';
import { CourtReserveModule } from './court-reserve/court-reserve.module';
import { RegisterModule } from './register/register.module';
import { TurnModule } from './turn/turn.module';
import { EmailController } from './email/email.controller';
import { EmailService } from './email/email.service';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    CourtModule,
    CourtReserveModule,
    RegisterModule,
    TurnModule,
    DatabaseModule,
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigModule available globally
    }),
  ],
  controllers: [AppController, EmailController],
  providers: [AppService, EmailService],
})
export class AppModule {}
