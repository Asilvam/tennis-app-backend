import { Injectable } from '@nestjs/common';
import { CreateRegisterDto } from './dto/create-register.dto';
import { UpdateRegisterDto } from './dto/update-register.dto';
import {InjectRepository} from "@nestjs/typeorm";
import {RegisterEntity} from "./entities/register.entity";
import {Repository} from "typeorm";

@Injectable()
export class RegisterService {
  constructor(
      @InjectRepository(RegisterEntity)
      private registrationRepository: Repository<RegisterEntity>,
  ) {}

  create(createRegisterDto: any) {
    console.log(createRegisterDto);
    return this.registrationRepository.save(createRegisterDto);
  }

  findAll() {
    return `This action returns all register`;
  }

  findOne(id: number) {
    return `This action returns a #${id} register`;
  }

  update(id: number, updateRegisterDto: UpdateRegisterDto) {
    return `This action updates a #${id} register`;
  }

  remove(id: number) {
    return `This action removes a #${id} register`;
  }
}
