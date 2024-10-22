import { Controller, Get, Post, Body, Param, Delete, Logger, Patch } from '@nestjs/common';
import { RegisterService } from './register.service';
import { CreateRegisterDto } from './dto/create-register.dto';
import { UpdateRegisterDto } from './dto/update-register.dto';

@Controller('register')
export class RegisterController {
  logger = new Logger(RegisterController.name);
  constructor(private readonly registerService: RegisterService) {}

  @Get()
  findAll() {
    return this.registerService.findAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.registerService.remove(+id);
  }

  @Post()
  register(@Body() registerDto: CreateRegisterDto) {
    return this.registerService.create(registerDto);
  }

  @Get('names')
  findAllNAmes() {
    return this.registerService.findAllNamePlayers();
  }

  @Patch(':email')
  update(@Param('email') email: string, @Body() updateRegisterDto: UpdateRegisterDto) {
    return this.registerService.updateByEmail(email, updateRegisterDto);
  }
}
