import { PickType } from '@nestjs/mapped-types';
import { CreateRegisterDto } from './create-register.dto';

// Public signup must never accept administrative or verification fields.
export class PublicRegisterDto extends PickType(CreateRegisterDto, [
  'namePlayer', 'email', 'cellular', 'pwd', 'urlEmail', 'partnerType', 'categories',
] as const) {}
