import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Register } from './entities/register.entity';
import { CreateRegisterDto } from './dto/create-register.dto';
import { EmailService } from '../email/email.service';
import { UpdateRegisterDto } from './dto/update-register.dto';
import { PlayerCategoryPointsService } from '../player-category-points/player-category-points.service';
import { AdminUpdateRegisterDto } from './dto/admin-update-register.dto';
import { TipoSocio } from './enums/tipo-socio.enum';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { BillingDueAdjustmentService } from '../membership-billing/billing-due-adjustment.service';

interface PlayerData {
  email: string;
  name: string;
  cellular: string;
  categories: { category: string; points: number; isActive: boolean }[];
}

@Injectable()
export class RegisterService {
  private readonly logger = new Logger(RegisterService.name);

  constructor(
    @InjectModel('Register')
    private readonly registerModel: Model<Register>,
    private readonly emailService: EmailService,
    private readonly playerCategoryPointsService: PlayerCategoryPointsService,
    private readonly billingAdjustment?: BillingDueAdjustmentService,
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

  async getAllNigthsLigths(namePlayer: string) {
    try {
      const response = await this.registerModel.find({ namePlayer: namePlayer, isLigthNigth: true }).exec();
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

    // ❌ Ya no incluimos category, points, pointsDoubles (eliminados del DTO)
    const registerEntity = {
      namePlayer: registerDto.namePlayer,
      email: registerDto.email,
      cellular: registerDto.cellular,
      partnerType: registerDto.partnerType,
      role: 'user',
      statePlayer: false,
      updatePayment: true, // Preserve the existing signup policy; this is not a verified payment.
      emailVerified: false,
      pwd: hashedPassword,
      categories: undefined, // Eliminar categories del DTO antes de guardar en Register
    };

    const newRegister = new this.registerModel(registerEntity);
    const response = await newRegister.save();

    // ✅ NUEVO: Inicializar categorías en la tabla player_category_points
    if (response && registerDto.categories && registerDto.categories.length > 0) {
      try {
        await this.playerCategoryPointsService.initializePlayerCategories(registerDto.email, registerDto.categories);
        this.logger.log(`Categorías inicializadas para ${registerDto.email}: ${registerDto.categories.map((c) => `${c.category}(${c.matchTypes.join(',')})`).join(', ')}`);
      } catch (error) {
        this.logger.error(`Error al inicializar categorías para ${registerDto.email}:`, error);
        // No lanzamos error para no bloquear el registro
        // Las categorías pueden agregarse después
      }
    }

    if (response) {
      const verificationLink = `${registerDto.urlEmail}/verify-email?token=${newRegister.verificationToken}`;
      await this.emailService.sendVerificationEmail(registerDto.email, verificationLink);
    }
    return response;
  }

  async remove(id: number) {
    return `This action removes a #${id} register`;
  }

  // Reemplaza el método findOneEmail completo (línea 199 en adelante)
  async findOneEmail(player: string): Promise<PlayerData | null> {
    try {
      const response: Register = await this.registerModel.findOne({ $or: [{ email: player }, { namePlayer: player }] }).exec();
      if (!response) {
        this.logger.error('Email Player not found', player);
        throw new NotFoundException('Name Player Register not found');
      }

      const categoryRecords = await this.playerCategoryPointsService.getPlayerCategories(response.email);
      const categories = categoryRecords.map((c) => ({
        category: c.category,
        points: c.points,
        isActive: c.isActive,
      }));

      return {
        email: response.email,
        name: response.namePlayer,
        cellular: response.cellular,
        categories,
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
    const register: Register | undefined = await this.registerModel.findOne({ email: email.toLowerCase() }).select('namePlayer email pwd role statePlayer updatePayment').exec();
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
    if (Object.keys(updateRegisterDto).some(key => key.startsWith('$') || key.includes('.'))) {
      throw new BadRequestException('La actualización debe contener campos simples.');
    }
    if (Object.prototype.hasOwnProperty.call(updateRegisterDto, 'titularId')) {
      throw new ForbiddenException('La asociación con un titular requiere la ruta administrativa.');
    }
    // Keep old clients sending an unchanged partnerType compatible, but do not
    // allow the public profile route to bypass the administrative membership edit.
    if (Object.prototype.hasOwnProperty.call(updateRegisterDto, 'partnerType')) {
      const current = await this.registerModel.findOne({ email }).select('partnerType').lean().exec();
      if (!current) throw new NotFoundException(`Register with email ${email} not found`);
      if (updateRegisterDto.partnerType !== (current.partnerType ?? TipoSocio.TITULAR)) {
        throw new ForbiddenException('Cambiar el tipo de socio requiere la ruta administrativa.');
      }
      const { partnerType, ...rest } = updateRegisterDto;
      updateRegisterDto = rest as UpdateRegisterDto;
    }
    const updatedRegister = await this.registerModel.findOneAndUpdate({ email: email }, updateRegisterDto, { new: true }).exec();
    if (!updatedRegister) {
      throw new NotFoundException(`Register with email ${email} not found`);
    }
    return updatedRegister;
  }

  async updateProfileByEmail(email: string, dto: UpdateProfileDto): Promise<Register> {
    const allowedFields = ['namePlayer', 'cellular', 'imageUrlProfile'];
    if (Object.keys(dto).some(key => !allowedFields.includes(key))) {
      throw new ForbiddenException('El perfil no permite modificar permisos, pagos ni datos de verificación.');
    }
    const changes = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    const updated = await this.registerModel.findOneAndUpdate({ email }, { $set: changes }, { new: true, runValidators: true }).exec();
    if (!updated) throw new NotFoundException(`Register with email ${email} not found`);
    return updated;
  }

  async updateAdminByEmail(email: string, dto: AdminUpdateRegisterDto, actorEmail?: string): Promise<Register> {
    const normalizedEmail = email.trim();
    const changesMembership = Object.prototype.hasOwnProperty.call(dto, 'partnerType') || Object.prototype.hasOwnProperty.call(dto, 'titularId');
    const changesState = Object.prototype.hasOwnProperty.call(dto, 'statePlayer');
    if (!changesMembership && !changesState) return this.updateByEmail(normalizedEmail, dto as UpdateRegisterDto);

    // Both the assignment and titular type changes touch the titular document.
    // Transactions therefore prevent a simultaneous assignment/demotion race.
    return this.registerModel.db.transaction(async session => {
      const current = await this.registerModel.findOne({ email: normalizedEmail }).select('+billingClosure').session(session).lean().exec();
      if (!current) throw new NotFoundException('Socio no encontrado.');
      if (dto.statePlayer === true && current.billingClosure)
        throw new ConflictException('El socio fue dado de baja por mensualidades. Usa la reinscripcion para aprobar una nueva vigencia.');
      if (!changesMembership) {
        return this.registerModel.findOneAndUpdate({ _id: current._id },
          { $set: dto, $inc: { __v: 1 } }, { new: true, runValidators: true, session }).exec();
      }
      const requestedType = dto.partnerType ?? current.partnerType ?? TipoSocio.TITULAR;
      const partnerType = requestedType === TipoSocio.FAMILIAR ? TipoSocio.CARGA : requestedType;
      if (![TipoSocio.TITULAR, TipoSocio.CARGA].includes(partnerType)) throw new BadRequestException('Tipo de socio inválido.');
      const set = { ...dto, partnerType };
      delete set.titularId;
      const update: Record<string, unknown> = { $set: set, $inc: { __v: 1 } };

      if (partnerType === TipoSocio.CARGA) {
        const titularId = Object.prototype.hasOwnProperty.call(dto, 'titularId') ? dto.titularId : current.titularId?.toString();
        if (typeof titularId !== 'string' || !/^[a-f0-9]{24}$/i.test(titularId)) throw new BadRequestException('Selecciona un titular válido para la carga.');
        if (current._id.toString() === titularId.toLowerCase()) throw new BadRequestException('Un socio no puede ser su propio titular.');
        const dependent = await this.registerModel.exists({ titularId: current._id }).session(session);
        if (dependent) throw new ConflictException('Este titular tiene cargas asociadas. Reasígnalas antes de convertirlo en carga.');
        const titular = await this.registerModel.findOne({ _id: titularId }).session(session).lean().exec();
        if (!titular) throw new NotFoundException('El titular seleccionado no existe.');
        if ((titular.partnerType ?? TipoSocio.TITULAR) !== TipoSocio.TITULAR) throw new BadRequestException('El socio seleccionado no es titular.');
        const locked = await this.registerModel.updateOne({ _id: titular._id }, { $inc: { __v: 1 } }, { session }).exec();
        if (locked.matchedCount !== 1) throw new ConflictException('El titular cambió durante la edición. Intenta nuevamente.');
        update.$set = { ...set, titularId: new Types.ObjectId(titularId) };
      } else {
        if (dto.titularId) throw new BadRequestException('Un socio titular no debe tener otro titular asociado.');
        update.$unset = { titularId: 1 };
      }

      const updated = await this.registerModel.findOneAndUpdate({ _id: current._id }, update, { new: true, runValidators: true, session }).exec();
      if (!updated) throw new NotFoundException('Socio no encontrado.');
      await this.billingAdjustment?.repriceOpenDues(updated, actorEmail, session);
      return updated;
    }, { readPreference: 'primary' });
  }
}
