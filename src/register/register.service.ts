import {Injectable, Logger} from '@nestjs/common';
import {CreateRegisterDto} from './dto/create-register.dto';
import {UpdateRegisterDto} from './dto/update-register.dto';
import {InjectRepository} from "@nestjs/typeorm";
import {Register} from "./entities/register";
import {Repository} from "typeorm";
import * as bcrypt from 'bcrypt';
import {AwsSesService} from "../aws-ses/aws-ses.service";


@Injectable()
export class RegisterService {
    logger = new Logger(RegisterService.name);
    constructor(
        @InjectRepository(Register)
        private registrationRepository: Repository<Register>,
        private readonly awsSesService: AwsSesService
    ) {
    }

    async hashPassword(password: string): Promise<string> {
        const saltRounds = 10;
        return await bcrypt.hash(password, saltRounds);
    }

    async create(createRegisterDto: any, hashedPassword: string) {
        const registerEntity = {
            ...createRegisterDto,
            pwd: hashedPassword,
            "statePlayer": true,
            "role": "user"
        };
        const response = await this.registrationRepository.save(registerEntity);
        if (response) {
            this.awsSesService.verifyEmailIdentity(createRegisterDto.email);
            return {status: 200, data: response};
        } else {
            return {status: 'error', message: 'Failed to create registration'};
        }
    }

    async findAll() {
        return await this.registrationRepository.find();
    }

    async findAllNamePlayers(): Promise<string[]> {
        const registers = await this.registrationRepository.find({where: {statePlayer: true}});
        this.logger.log(registers.map(register => register.namePlayer));
        return registers.map(register => register.namePlayer);
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
