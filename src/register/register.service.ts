import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { UpdateRegisterDto } from './dto/update-register.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Register } from './entities/register';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import * as bcryptjs from 'bcryptjs';
import { CreateRegisterDto } from './dto/create-register.dto';
import { Role } from '../common/enums/rol.enum';

@Injectable()
export class RegisterService {
  logger = new Logger(RegisterService.name);

  constructor(
    @InjectRepository(Register)
    private registrationRepository: Repository<Register>,
    private readonly emailService: EmailService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return await bcryptjs.hash(password, saltRounds);
  }

  async validatePlayerEmail(email: string) {
    const register: Register | undefined =
      await this.registrationRepository.findOne({
        where: { email: email },
      });
    this.logger.log('register', { register });
    return register;
  }

  async findOneByEmail(email: string) {
    const result = await this.registrationRepository.findOneBy({ email });
    this.logger.log('result', { result });
    return result;
  }

  async create(registerDto: CreateRegisterDto) {
    const user: Register | null = await this.registrationRepository.findOne({
      where: { email: registerDto.email },
    });
    if (user) {
      throw new BadRequestException('User already exists');
    }
    const hashedPassword = await this.hashPassword(registerDto.pwd);
    const registerEntity = {
      ...registerDto,
      pwd: hashedPassword,
      role: Role.USER,
      statePlayer: true,
    };
    return await this.registrationRepository.save(registerEntity);
  }

  async findAll() {
    return await this.registrationRepository.find();
  }

  async findAllNamePlayers(): Promise<string[]> {
    const registers = await this.registrationRepository.find({
      where: { statePlayer: true },
      order: { namePlayer: 'ASC' },
    });
    return registers.map((register) => register.namePlayer);
  }

  async findOneEmail(player: string): Promise<any> {
    try {
      const response = await this.registrationRepository.find({
        where: { namePlayer: player },
      });
      if (!response) {
        return { status: 404 };
      }
      const email = response[0].email;
      return email;
    } catch (error) {
      this.logger.error('Error:', error.message);
      return { status: 500 };
    }
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
