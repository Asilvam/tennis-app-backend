import { Controller, Get, Post, Body, Param, Delete, Logger, Patch, HttpStatus, HttpCode, UseInterceptors, UploadedFile, UseGuards, Req, ForbiddenException, UsePipes, ValidationPipe } from '@nestjs/common';
import { RegisterService } from './register.service';
import { PublicRegisterDto } from './dto/public-register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminUpdateRegisterDto } from './dto/admin-update-register.dto';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PasswordRecoveryService } from './password-recovery.service';
import { ConfirmPasswordResetDto } from './dto/confirm-password-reset.dto';

@Controller('register')
export class RegisterController {
  private readonly logger = new Logger(RegisterController.name);
  constructor(
    private readonly registerService: RegisterService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly passwordRecoveryService: PasswordRecoveryService,
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
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  register(@Body() registerDto: PublicRegisterDto) {
    return this.registerService.create(registerDto);
  }

  @Post(['resetpass', 'password-recovery'])
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.passwordRecoveryService.requestReset(resetPasswordDto.email);
  }

  @Post('admin/resetpass')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async requestAdminPasswordReset(@Body() dto: ResetPasswordDto) {
    return this.passwordRecoveryService.requestReset(dto.email, true);
  }

  @Post('password-recovery/confirm')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.passwordRecoveryService.confirmReset(dto);
  }

  @Post('updateLightNigths')
  updateLightNigths(@Body() data: any[]) {
    data.forEach((item: any) => {
      this.registerService.findOneAndUpdate(item.namePlayer, { isLigthNigth: true });
    });
    return;
  }

  @Post('profile')
  @UseGuards(JwtAuthGuard)
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

  @Patch('admin/:email')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  updateAdmin(@Param('email') email: string, @Body() dto: AdminUpdateRegisterDto) {
    return this.registerService.updateAdminByEmail(email, dto);
  }

  @Patch(':email')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  update(@Param('email') email: string, @Body() dto: UpdateProfileDto, @Req() request: { user: { email: string } }) {
    if (!request.user.email || request.user.email.toLowerCase() !== email.trim().toLowerCase()) {
      throw new ForbiddenException('Solo puedes editar tu propio perfil. Usa la ruta administrativa para editar otros usuarios.');
    }
    return this.registerService.updateProfileByEmail(request.user.email, dto);
  }
  // --- Endpoint para habilitar el pago de un jugador ---
  @Patch('payment/enable/:email')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  async enablePayment(@Param('email') email: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Attempting to enable payment for email: ${email}`);
    // El servicio maneja NotFoundException y retorna el objeto {success, message}
    return this.registerService.enablePlayerPayment(email);
  }

  // --- Endpoint para bloquear el pago de un jugador ---
  @Patch('payment/block/:email')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  async blockPayment(@Param('email') email: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Attempting to block payment for email: ${email}`);
    // El servicio maneja NotFoundException y retorna el objeto {success, message}
    return this.registerService.blockPlayerPayment(email);
  }
}
