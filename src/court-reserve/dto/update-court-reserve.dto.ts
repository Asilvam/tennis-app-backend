import { PartialType } from '@nestjs/mapped-types';
import { CreateCourtReserveDto } from './create-court-reserve.dto';

export class UpdateCourtReserveDto extends PartialType(CreateCourtReserveDto) {}
