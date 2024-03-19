import { Injectable } from '@nestjs/common';
import { CreateAuthDto } from './dto/create-auth.dto';
import { UpdateAuthDto } from './dto/update-auth.dto';
import {InjectRepository} from "@nestjs/typeorm";
import {Register} from "../register/entities/register";
import {Repository} from "typeorm";
import * as bcrypt from 'bcrypt';
import { FindOneOptions } from 'typeorm';

@Injectable()
export class AuthService {

  constructor(
      @InjectRepository(Register)
      private readonly registerRepository: Repository<Register>,
  ) {}

  async findRegisterByUsername(username: string): Promise<Register> {
    const response = await this.registerRepository.findOne({ where: { user: username } } as FindOneOptions<Register>);
    return response;
  }

  async comparePasswords(plainTextPassword: string, hashedPassword: string): Promise<boolean> {
    return await bcrypt.compare(plainTextPassword, hashedPassword);
  }

  validate(createAuthDto: any) {
    console.log(createAuthDto);
    return 'This action adds a new auth';
  }

  findAll() {
    return `This action returns all auth`;
  }

  findOne(id: number) {
    return `This action returns a #${id} auth`;
  }

  update(id: number, updateAuthDto: UpdateAuthDto) {
    return `This action updates a #${id} auth`;
  }

  remove(id: number) {
    return `This action removes a #${id} auth`;
  }
}
