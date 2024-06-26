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
import { UpdateRegisterDto } from './dto/update-register.dto';
import { CreateRegisterDto } from './dto/create-register.dto';

@Controller('register')
export class RegisterController {
  constructor(private readonly registerService: RegisterService) {}

  @Post()
  async create(@Body() createRegisterDto: CreateRegisterDto) {
    const { pwd, email, namePlayer } = createRegisterDto;
    const hashedPassword = await this.registerService.hashPassword(pwd);
    const emailPlayerExist =
      await this.registerService.validatePlayerEmail(email);
    const namePlayerExist =
      await this.registerService.validatePlayerName(namePlayer);
    if (emailPlayerExist) {
      return { status: 400, message: 'Email already registered' };
    }
    if (namePlayerExist) {
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

  @Post('player')
  findOneEmail(@Body() player: string) {
    console.log(player);
    return this.registerService.findOneEmail(player);
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
