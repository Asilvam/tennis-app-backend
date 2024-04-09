import { PartialType } from '@nestjs/mapped-types';

export class CreateRegisterDto {
  namePlayer: string;
  email: string;
  celular: string;
  pwd: string;
}

export class UpdatePlayerDTO extends PartialType(CreateRegisterDto) {}
