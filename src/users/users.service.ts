import {Injectable} from '@nestjs/common';
import {CreateUserDto} from './dto/create-user.dto';
import {UpdateUserDto} from './dto/update-user.dto';
import {InjectRepository} from "@nestjs/typeorm";
import {Repository} from "typeorm";
import {UserEntity} from "./entities/user.entity";

@Injectable()
export class UsersService {

    constructor(
        @InjectRepository(UserEntity)
        private readonly userEntityRepository: Repository<UserEntity>,
    ) {
    }

    async create(createUserDto: CreateUserDto) {
        const newPrvbusinessUnit = this.userEntityRepository.create(
            createUserDto,
        );
        return await this.userEntityRepository.save(newPrvbusinessUnit);
    }

    async findAll2play() {
        const resp = await this.userEntityRepository.find({
            where: {
                stateUser: true,
            },
        });
        return resp;
    }

    async findAll() {
        return this.userEntityRepository.find();
    }

    findOne(id: number) {
        return `This action returns a #${id} user`;
    }

    update(id: number, updateUserDto: UpdateUserDto) {
        return `This action updates a #${id} user`;
    }

    remove(id: number) {
        return `This action removes a #${id} user`;
    }
}
