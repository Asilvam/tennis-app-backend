import { IsString, IsNumber, IsNotEmpty } from 'class-validator';

export class CreateMpDto {
  @IsString()
  @IsNotEmpty()
  courtId: string;

  @IsString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  time: string;

  @IsString()
  @IsNotEmpty()
  player1: string;

  @IsNumber()
  @IsNotEmpty()
  amount: number;
}
