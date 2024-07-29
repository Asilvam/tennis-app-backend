import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { RegisterModule } from './register/register.module';
import { AuthModule } from './auth/auth.module';
import { JwtService } from './jwt/jwt.service';
import { CourtReserveModule } from './court-reserve/court-reserve.module';
import { EmailController } from './email/email.controller';
import { TurnModule } from './turn/turn.module';
import { CourtModule } from './court/court.module';
import { EmailService } from './email/email.service';

@Module({
  imports: [
    DatabaseModule,
    RegisterModule,
    AuthModule,
    CourtReserveModule,
    TurnModule,
    CourtModule,
  ],
  controllers: [AppController, EmailController],
  providers: [AppService, JwtService, EmailService],
  exports: [EmailService],
})
export class AppModule {}
