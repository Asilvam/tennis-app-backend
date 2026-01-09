import { PartialType } from '@nestjs/swagger';
import { CreateMpDto } from './create-mp.dto';

export class UpdateMpDto extends PartialType(CreateMpDto) {}
