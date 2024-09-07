import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateTurnDto {
  @IsNotEmpty()
  @IsNumber()
  turnNumber: number;

  @IsOptional()
  @IsBoolean()
  state?: boolean;

  @IsNotEmpty()
  @IsString()
  schedule: string;

  @IsOptional()
  @IsBoolean()
  isPayed?: boolean;
}
