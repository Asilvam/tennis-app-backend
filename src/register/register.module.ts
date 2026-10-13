import { Module } from '@nestjs/common';
import { RegisterService } from './register.service';
import { RegisterController } from './register.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Register, RegisterSchema } from './entities/register.entity';
// import { EmailModule } from '../email/email.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { EmailService } from '../email/email.service';
import { PlayerCategoryPointsModule } from '../player-category-points/player-category-points.module';
import { PasswordRecoveryService } from './password-recovery.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Register.name, schema: RegisterSchema }]),
    // EmailModule,
    CloudinaryModule,
    PlayerCategoryPointsModule, // ✅ NUEVO: Importar para usar PlayerCategoryPointsService
  ],
  controllers: [RegisterController],
  providers: [RegisterService, EmailService, PasswordRecoveryService],
  exports: [RegisterService, MongooseModule],
})
export class RegisterModule {}
