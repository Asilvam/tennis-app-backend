import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { CourtReserve, CourtReserveSchema } from '../court-reserve/entities/court-reserve.entity';
import { MembershipDue, MembershipDueSchema } from '../membership-billing/entities/membership-due.entity';
import {
  MembershipBillingConfig,
  MembershipBillingConfigSchema,
} from '../membership-billing/entities/membership-billing-config.entity';
import { AdminDirectoryController } from './admin-directory.controller';
import { AdminDirectoryService } from './admin-directory.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Register.name, schema: RegisterSchema.clone().set('autoCreate', false).set('autoIndex', false) },
      { name: CourtReserve.name, schema: CourtReserveSchema.clone().set('autoCreate', false).set('autoIndex', false) },
      {
        name: MembershipDue.name,
        schema: MembershipDueSchema.clone().set('autoCreate', false).set('autoIndex', false),
      },
      {
        name: MembershipBillingConfig.name,
        schema: MembershipBillingConfigSchema.clone().set('autoCreate', false).set('autoIndex', false),
      },
    ]),
  ],
  controllers: [AdminDirectoryController],
  providers: [AdminDirectoryService],
})
export class AdminDirectoryModule {}
