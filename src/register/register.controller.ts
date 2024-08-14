import { Controller, Get, Post, Body, Param, Delete } from '@nestjs/common';
import { RegisterService } from './register.service';
import { CreateRegisterDto } from './dto/create-register.dto';
import { Auth } from "../auth/decorators/auth.decorator";
import { Role } from "../common/enums/rol.enum";

@Auth(Role.USER)
@Controller('register')
export class RegisterController {
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
}
