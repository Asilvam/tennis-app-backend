import {Injectable} from '@nestjs/common';
import {CreateRegisterDto} from './dto/create-register.dto';
import {UpdateRegisterDto} from './dto/update-register.dto';
import {InjectRepository} from "@nestjs/typeorm";
import {RegisterEntity} from "./entities/register.entity";
import {Repository} from "typeorm";
import * as bcrypt from 'bcrypt';


@Injectable()
export class RegisterService {
    constructor(
        @InjectRepository(RegisterEntity)
        private registrationRepository: Repository<RegisterEntity>,
    ) {
    }

    async hashPassword(password: string): Promise<string> {
        const saltRounds = 10;
        return await bcrypt.hash(password, saltRounds);
    }

    async create(createRegisterDto: any, hashedPassword: string) {
        // console.log(createRegisterDto);
        // console.log(hashedPassword);
        const registerEntity = {...createRegisterDto, pwd: hashedPassword};
        const response = await this.registrationRepository.save(registerEntity);
        if (response) {
            return {status: 200, data: response};
        } else {
            return {status: 'error', message: 'Failed to create registration'};
        }
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
