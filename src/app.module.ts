import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CourtModule } from './court/court.module';
import { CourtReserveModule } from './court-reserve/court-reserve.module';
import { RegisterModule } from './register/register.module';
import { TurnModule } from './turn/turn.module';
import { DatabaseModule } from './database/database.module';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from './email/email.module';

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
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
