import { Module } from '@nestjs/common';
import { RegisterService } from './register.service';
import { RegisterController } from './register.controller';
import {TypeOrmModule} from "@nestjs/typeorm";
import {RegisterEntity} from "./entities/register.entity";

@Module({
  controllers: [RegisterController],
  providers: [RegisterService],
  imports: [TypeOrmModule.forFeature([RegisterEntity])],
})
export class RegisterModule {}
