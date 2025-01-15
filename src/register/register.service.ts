import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Register } from './entities/register.entity';
import { CreateRegisterDto } from './dto/create-register.dto';
import { EmailService } from '../email/email.service';
import { UpdateRegisterDto } from './dto/update-register.dto';

interface PlayerData {
  email: string;
  points: string;
  category: string;
  cellular: string;
}

@Injectable()
export class RegisterService {
  logger = new Logger(RegisterService.name);

  constructor(
    @InjectModel('Register')
    private readonly registerModel: Model<Register>,
    private readonly emailService: EmailService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  }

  generateRandomPassword(length: number): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!';
    let password = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      password += characters[randomIndex];
    }
    return password;
  }

  async createNewPassword(): Promise<{ plainPassword: string; hashedPassword: string }> {
    const plainPassword = this.generateRandomPassword(6); // Genera una contraseña de 6 caracteres
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);

    return { plainPassword, hashedPassword };
  }

  async resetPassword(email: any): Promise<{ success: boolean; message: string; newPassword?: string }> {
    this.logger.log(email.email);
    try {
      const user = this.registerModel.findOne({ email });
      if (!user) {
        return { success: false, message: 'Usuario no encontrado' };
      }
      const { plainPassword, hashedPassword } = await this.createNewPassword();
      this.logger.log('Nueva contraseña generada:', plainPassword);
      this.logger.log('Contraseña encriptada (hash):', hashedPassword);
      await this.registerModel.updateOne({ email: email.email }, { pwd: hashedPassword });
      return {
        success: true,
        message: 'Contraseña actualizada con éxito',
        newPassword: plainPassword,
      };
    } catch (error) {
      this.logger.error('Error al actualizar la contraseña:', error);
      return { success: false, message: 'Error al actualizar la contraseña' };
    }
  }

  async findAll(): Promise<Register[]> {
    try {
      const registers = await this.registerModel.find().sort({ namePlayer: 1 }).exec();
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
    const response = await newRegister.save();
    if (response) {
      const verificationLink = `${registerDto.urlEmail}/verify-email?token=${newRegister.verificationToken}`;
      await this.emailService.sendVerificationEmail(registerDto.email, verificationLink);
    }
    return response;
  }

  async remove(id: number) {
    return `This action removes a #${id} register`;
  }

  async findOneEmail(player: string): Promise<PlayerData | null> {
    try {
      const response: Register = await this.registerModel.findOne({ namePlayer: player }).exec();
      if (!response) {
        throw new NotFoundException('Name Player Register not found');
      }
      return {
        email: response.email,
        points: response.points,
        category: response.category,
        cellular: response.cellular,
      };
    } catch (error) {
      this.logger.error('Error:', error.message);
      throw new BadRequestException(`Error finding register: ${error.message}`);
    }
  }

  async findAllNamePlayers(): Promise<string[]> {
    // this.logger.log('find all name players');
    const registers = await this.registerModel
      .find({ statePlayer: true, updatePayment: true }) // Filter where statePlayer is true
      .sort({ namePlayer: 'asc' }) // Sort by namePlayer in ascending order
      .select('namePlayer') // Select only the namePlayer field
      .exec(); // Execute the query
    // if (!registers) {
    //   this.logger.log('not found registers');
    // } else {
    //   this.logger.log(`return  ${registers.length}  registers`);
    // }
    return registers.map((register) => register.namePlayer);
  }

  async validatePlayerEmail(email: string): Promise<Register | undefined> {
    const register: Register | undefined = await this.registerModel
      .findOne({ email: email })
      .select('namePlayer email pwd role statePlayer updatePayment')
      .exec();
    return register;
  }

  findOneByEmail(email: string) {
    return this.registerModel.findOne({ email });
  }

  async findByVerificationToken(token: string) {
    return this.registerModel.findOne({ verificationToken: token });
  }

  async updateByEmail(email: string, updateRegisterDto: UpdateRegisterDto): Promise<Register> {
    const updatedRegister = await this.registerModel
      .findOneAndUpdate({ email: email }, updateRegisterDto, { new: true })
      .exec();

    if (!updatedRegister) {
      throw new NotFoundException(`Register with email ${email} not found`);
    }

    return updatedRegister;
  }
}
