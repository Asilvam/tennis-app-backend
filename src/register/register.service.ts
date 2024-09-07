import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Register } from './entities/register.entity';
import { CreateRegisterDto } from './dto/create-register.dto';

@Injectable()
export class RegisterService {
  logger = new Logger(RegisterService.name);

  constructor(
    @InjectModel('Register')
    private readonly registerModel: Model<Register>,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  }

  async findAll(): Promise<Register[]> {
    this.logger.log('Finding all registers');
    try {
      const registers = await this.registerModel.find().exec();
      return registers;
    } catch (error) {
      this.logger.error('Failed to find all registers', error.stack);
      throw new InternalServerErrorException('Failed to retrieve registers');
    }
  }

  async create(registerDto: CreateRegisterDto) {
    const user: Register | null = await this.registerModel.findOne({ email: registerDto.email }).exec();
    if (user) {
      throw new BadRequestException('User already exists');
    }
    const hashedPassword = await this.hashPassword(registerDto.pwd);
    const registerEntity = {
      ...registerDto,
      pwd: hashedPassword,
    };
    const newRegister = new this.registerModel(registerEntity);
    return newRegister.save();
  }

  remove(id: number) {
    return `This action removes a #${id} register`;
  }

  async findOneEmail(player: string): Promise<string | object | null> {
    try {
      const response: Register = await this.registerModel.findOne({ namePlayer: player }).exec();
      if (!response) {
        return { status: 404 };
      }
      return { email: response.email }; // Return the email in an object
    } catch (error) {
      this.logger.error('Error:', error.message);
      return { status: 500 };
    }
  }

  async findAllNamePlayers(): Promise<string[]> {
    this.logger.log('find all name players');
    const registers = await this.registerModel
      .find({ statePlayer: true }) // Filter where statePlayer is true
      .sort({ namePlayer: 'asc' }) // Sort by namePlayer in ascending order
      .select('namePlayer') // Select only the namePlayer field
      .exec(); // Execute the query
    if (!registers) {
      this.logger.log('not found registers');
    } else {
      this.logger.log(`return  ${registers.length}  registers`);
    }
    return registers.map((register) => register.namePlayer);
  }

  async validatePlayerEmail(email: string): Promise<Register | undefined> {
    const register: Register | undefined = await this.registerModel
      .findOne({ email: email, statePlayer: true })
      .select('namePlayer email pwd role')
      .exec();
    if (!register) {
      this.logger.log('register', { register });
    }
    return register;
  }

  findOneByEmail(email: string) {
    return this.registerModel.findOne({ email });
  }
}
