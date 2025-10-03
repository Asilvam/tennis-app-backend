import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Logger,
  Patch,
  HttpStatus,
  HttpCode,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { RegisterService } from './register.service';
import { CreateRegisterDto } from './dto/create-register.dto';
import { UpdateRegisterDto } from './dto/update-register.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { response } from 'express';

@Controller('register')
export class RegisterController {
  logger = new Logger(RegisterController.name);
  constructor(
    private readonly registerService: RegisterService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Get()
  findAll() {
    return this.registerService.findAll();
  }

  @Get('active/:namePlayer')
  findIfHasReserveNigthLigth(@Param('namePlayer') namePlayer: string) {
    return this.registerService.getAllNigthsLigths(namePlayer);
  }

  @Get('profile/:email')
  findOne(@Param('email') email: string) {
    return this.registerService.findOneByEmail(email);
  }


  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.registerService.remove(+id);
  }

  @Post()
  register(@Body() registerDto: CreateRegisterDto) {
    return this.registerService.create(registerDto);
  }

  @Post('resetpass')
  resetPassword(@Body() email: any) {
    return this.registerService.resetPassword(email);
  }

  @Post('updateLightNigths')
  updateLightNigths(@Body() data: any[]) {
    data.forEach((item: any) => {
      this.registerService.findOneAndUpdate(item.namePlayer, { isLigthNigth: true });
    });
    return;
  }

  @Post('profile')
  @UseInterceptors(FileInterceptor('image'))
  async uploadProfileImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    try {
      const uploadedImage = await this.cloudinaryService.uploadImageBuffer(file.buffer); // Ensure file.path is correct
      return { imageUrl: uploadedImage.secure_url };
    } catch (error) {
      throw new Error(`Failed to upload image to Cloudinary: ${error.message}`);
    }
  }

  @Get('names')
  findAllNAmes() {
    return this.registerService.findAllNamePlayers();
  }

  @Patch(':email')
  update(@Param('email') email: string, @Body() updateRegisterDto: UpdateRegisterDto) {
    return this.registerService.updateByEmail(email, updateRegisterDto);
  }
  // --- Endpoint para habilitar el pago de un jugador ---
  @Patch('payment/enable/:email')
  @HttpCode(HttpStatus.OK)
  async enablePayment(@Param('email') email: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Attempting to enable payment for email: ${email}`);
    // El servicio maneja NotFoundException y retorna el objeto {success, message}
    return this.registerService.enablePlayerPayment(email);
  }

  // --- Endpoint para bloquear el pago de un jugador ---
  @Patch('payment/block/:email')
  @HttpCode(HttpStatus.OK)
  async blockPayment(@Param('email') email: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Attempting to block payment for email: ${email}`);
    // El servicio maneja NotFoundException y retorna el objeto {success, message}
    return this.registerService.blockPlayerPayment(email);
  }
}
