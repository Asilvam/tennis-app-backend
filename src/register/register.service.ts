import { Injectable, Logger } from '@nestjs/common';
import { UpdateRegisterDto } from './dto/update-register.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Register } from './entities/register';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { EmailService } from '../email/email.service';

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
    return await bcrypt.hash(password, saltRounds);
  }

  async validatePlayerEmail(email: string): Promise<boolean> {
    const player: Register | undefined =
      await this.registrationRepository.findOne({ where: { email } });
    return !!player;
  }

  async validatePlayerName(namePlayer: string): Promise<boolean> {
    const player: Register | undefined =
      await this.registrationRepository.findOne({ where: { namePlayer } });
    return !!player;
  }

  async create(createRegisterDto: any, hashedPassword: string) {
    const registerEntity = {
      ...createRegisterDto,
      pwd: hashedPassword,
      statePlayer: true,
      role: 'user',
    };
    const response = await this.registrationRepository.save(registerEntity);
    if (response) {
      // this.emailService.verifyEmailIdentity(createRegisterDto.email);
      return { status: 200, data: response };
    } else {
      return { status: 'error', message: 'Failed to create registration' };
    }
  }

  async findAll() {
    return await this.registrationRepository.find();
  }

  async findAllNamePlayers(): Promise<string[]> {
    const registers = await this.registrationRepository.find({
      where: { statePlayer: true },
      order: { namePlayer: 'ASC' },
    });
    this.logger.log(registers.map((register) => register.namePlayer));
    return registers.map((register) => register.namePlayer);
  }

  async findOneEmail(player: string): Promise<any> {
    try {
      // this.logger.log(player);
      const response = await this.registrationRepository.find({
        where: { namePlayer: player },
      });
      // this.logger.log('Response:', response);
      if (!response) {
        return { status: 404 };
      }
      const email = response[0].email;
      // this.logger.log('Email:', email);
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
