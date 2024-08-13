import { IsBoolean, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateCourtDto {
  @IsNumber()
  @IsNotEmpty()
  courtNumber: number;

  @IsBoolean()
  @IsNotEmpty()
  state: boolean;

  @IsString()
  @IsNotEmpty()
  description: string;
}
