import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { RegisterModule } from './register/register.module';
import { AuthModule } from './auth/auth.module';
import { CourtReserveModule } from './court-reserve/court-reserve.module';
import { EmailController } from './email/email.controller';
import { TurnModule } from './turn/turn.module';
import { CourtModule } from './court/court.module';
import { EmailService } from './email/email.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    DatabaseModule,
    RegisterModule,
    AuthModule,
    CourtReserveModule,
    TurnModule,
    CourtModule,
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigModule available globally
    }),
  ],
  controllers: [AppController, EmailController],
  providers: [AppService, EmailService],
  exports: [EmailService],
})
export class AppModule {}
