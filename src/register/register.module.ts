import { Module } from '@nestjs/common';
import { RegisterService } from './register.service';
import { RegisterController } from './register.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Register, RegisterSchema } from './entities/register.entity';
import { EmailModule } from '../email/email.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Register.name, schema: RegisterSchema }]),
    EmailModule,
    CloudinaryModule,
  ],
  controllers: [RegisterController],
  providers: [RegisterService],
  exports: [RegisterService, MongooseModule],
})
export class RegisterModule {}
