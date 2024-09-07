import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCourtDto {
  @IsNumber()
  @IsNotEmpty()
  courtNumber: number;

  @IsOptional()
  @IsBoolean()
  state?: boolean;

  @IsString()
  @IsNotEmpty()
  courtName: string;

  @IsOptional()
  @IsArray()
  courtScheduleTurns?: string[];
}
