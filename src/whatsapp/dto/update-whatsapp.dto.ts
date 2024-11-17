import { PartialType } from '@nestjs/swagger';
import { CreateWhatsappDto } from './create-whatsapp.dto';

export class UpdateWhatsappDto extends PartialType(CreateWhatsappDto) {}
