import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import {UserEntity} from "./entities/user.entity";
import {TypeOrmModule} from "@nestjs/typeorm";

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  imports: [TypeOrmModule.forFeature([UserEntity])],
})
export class UsersModule {}
