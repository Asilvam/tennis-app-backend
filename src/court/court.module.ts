import { Module } from '@nestjs/common';
import { CourtService } from './court.service';
import { CourtController } from './court.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { RegisterModule } from '../register/register.module';
import { Court, CourtSchema } from './entities/court.entity';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth/auth.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Court.name, schema: CourtSchema },
    ]),
    RegisterModule,
  ],
  controllers: [CourtController],
  providers: [CourtService, AuthService, JwtService],
})
export class CourtModule {}
