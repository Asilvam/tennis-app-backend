import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RegisterService } from './register.service';
import { CreateRegisterDto } from './dto/create-register.dto';
import { UpdateRegisterDto } from './dto/update-register.dto';

@Controller('register')
export class RegisterController {
  constructor(private readonly registerService: RegisterService) {}

  @Post()
  async create(@Body() createRegisterDto: any) {
    const hashedPassword = await this.registerService.hashPassword(
      createRegisterDto.pwd,
    );
    const emailPlayer = await this.registerService.validatePlayerEmail(createRegisterDto.email);
    const namePlayer = await this.registerService.validatePlayerName(createRegisterDto.namePlayer);
    if (emailPlayer) {
      return { status: 400, message: 'Email already registered' };
    }
    if (namePlayer) {
      return { status: 400, message: 'Name Player already registered' };
    }
    const result = await this.registerService.create(
      createRegisterDto,
      hashedPassword,
    );
    return { status: result.status, data: result.data };
  }

  @Get('names')
  findAllNAmes() {
    return this.registerService.findAllNamePlayers();
  }

  @Get()
  findAll() {
    return this.registerService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.registerService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateRegisterDto: UpdateRegisterDto,
  ) {
    return this.registerService.update(+id, updateRegisterDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.registerService.remove(+id);
  }
}
