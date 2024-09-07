import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { TurnService } from './turn.service';
import { CreateTurnDto } from './dto/create-turn.dto';
import { UpdateTurnDto } from './dto/update-turn.dto';
import { Auth } from '../auth/decorators/auth.decorator';
import { Role } from '../common/enums/rol.enum';

// @Auth(Role.USER)
@Controller('turn')
export class TurnController {
  constructor(private readonly turnService: TurnService) {}

  @Post()
  create(@Body() createTurnDto: CreateTurnDto) {
    return this.turnService.create(createTurnDto);
  }

  @Get('turns')
  findAllTurns() {
    return this.turnService.findAllTurns();
  }

  @Get()
  findAll() {
    return this.turnService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.turnService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTurnDto: UpdateTurnDto) {
    return this.turnService.update(+id, updateTurnDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.turnService.remove(+id);
  }
}
