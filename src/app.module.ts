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
import { NotificationModule } from './notification/notification.module';
import { InfoItemsModule } from './info-items/info-items.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { MatchRankingModule } from './match-ranking/match-ranking.module';
import { BookingModule } from './booking/booking.module';
import { MpModule } from './mp/mp.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { PlayerCategoryPointsModule } from './player-category-points/player-category-points.module';
import { NewsCTQModule } from './news-ctq/news-ctq.module';
import { ScheduleModule } from '@nestjs/schedule';

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
    NotificationModule,
    InfoItemsModule,
    CloudinaryModule,
    MatchRankingModule,
    BookingModule,
    MpModule,
    AuditLogModule,
    PlayerCategoryPointsModule,
    NewsCTQModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
