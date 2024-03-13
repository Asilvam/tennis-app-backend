import { PartialType } from '@nestjs/mapped-types';
import { CreateTurnDto } from './create-turn.dto';

export class UpdateTurnDto extends PartialType(CreateTurnDto) {}
