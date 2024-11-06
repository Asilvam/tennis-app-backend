import { PartialType } from '@nestjs/swagger';
import { CreateInfoItemDto } from './create-info-item.dto';

export class UpdateInfoItemDto extends PartialType(CreateInfoItemDto) {}
