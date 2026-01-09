import { Module } from '@nestjs/common';
import { MpService } from './mp.service';
import { MpController } from './mp.controller';

@Module({
  controllers: [MpController],
  providers: [MpService],
})
export class MpModule {}
