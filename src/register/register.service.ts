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
  name: string;
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

  // Función original para habilitar (con mejoras)
  // eslint-disable-next-line max-len
  async enablePlayerPayment(email: string): Promise<{ success: boolean; message: string }> {
    // Cambiado el nombre y el tipo de email
    try {
      const user = await this.registerModel.findOne({ email }); // Añadido await
      if (!user) {
        this.logger.warn(`Usuario con email ${email} no encontrado para habilitar.`);
        throw new NotFoundException('Usuario no encontrado');
      }
      // Se asegura de ponerlo en true
      await this.registerModel.updateOne({ email }, { updatePayment: true });
      this.logger.log(`Jugador con email ${email} habilitado (updatePayment: true).`);
      return {
        success: true,
        message: 'Estado de Pago actualizado con éxito.', // Mensaje claro
      };
    } catch (error) {
      this.logger.error(`Error al habilitar al jugador con email ${email}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al actualizar el estado del jugador.');
    }
  }

  // Nueva función para bloquear
  async blockPlayerPayment(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const user = await this.registerModel.findOne({ email }); // Añadido await
      if (!user) {
        this.logger.warn(`Usuario con email ${email} no encontrado para bloquear.`);
        throw new NotFoundException('Usuario no encontrado');
      }
      // Cambiamos el valor a false para bloquear
      await this.registerModel.updateOne({ email }, { updatePayment: false });
      this.logger.log(`Jugador con email ${email} bloqueado (updatePayment: false).`);
      return {
        success: true,
        message: 'Jugador bloqueado con éxito (pago no actualizado).', // Mensaje claro
      };
    } catch (error) {
      this.logger.error(`Error al bloquear al jugador con email ${email}:`, error);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al actualizar el estado del jugador.');
    }
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
    // this.logger.log(email.email);
    try {
      const user = this.registerModel.findOne({ email });
      if (!user) {
        return { success: false, message: 'Usuario no encontrado' };
      }
      const { plainPassword, hashedPassword } = await this.createNewPassword();
      // this.logger.log('Nueva contraseña generada:', plainPassword);
      // this.logger.log('Contraseña encriptada (hash):', hashedPassword);
      await this.registerModel.updateOne({ email: email.email }, { pwd: hashedPassword });
      await this.emailService.sendResetPasswordEmail(email.email, plainPassword);
      this.logger.log(`Contraseña actualizada para el usuario con email ${email.email}`);
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
  async getAllNigthsLigths(namePlayer: string) {
    try {
      const response = await this.registerModel.find({ namePlayer: namePlayer, isLigthNigth: true });
      if (response.length > 0) {
        return true;
      } else {
        return false;
      }
    } catch (e) {
      this.logger.error('Failed to find all registers', e.stack);
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
      this.logger.error('User already exists.');
      throw new BadRequestException('User mail already exists');
    }
    const exists = await this.registerModel.findOne({ cellular: registerDto.cellular });
    if (exists) {
      this.logger.error('Phone number already exists.');
      throw new BadRequestException('Phone number already exists.');
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
      const response: Register = await this.registerModel
        .findOne({ $or: [{ email: player }, { namePlayer: player }] })
        .exec();
      if (!response) {
        this.logger.error('Email Player not found', player);
        throw new NotFoundException('Name Player Register not found');
      }
      return {
        email: response.email,
        name: response.namePlayer,
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

  async findOneAndUpdate(player: string, updateRegisterDto: UpdateRegisterDto) {
    // this.logger.log('player--> ', player, 'data--> ', updateRegisterDto, updateRegisterDto);
    return await this.registerModel.findOneAndUpdate({ namePlayer: player }, updateRegisterDto);
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
