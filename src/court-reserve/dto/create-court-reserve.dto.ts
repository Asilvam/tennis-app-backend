import { IsBoolean, IsDateString, IsNotEmpty, IsString } from 'class-validator';

export class CreateCourtReserveDto {
  @IsNotEmpty()
  @IsString()
  court: string;

  @IsNotEmpty()
  @IsString()
  player1: string;

  @IsNotEmpty()
  @IsString()
  player2: string;

  @IsNotEmpty()
  @IsDateString()
  dateToPlay: string;

  @IsNotEmpty()
  @IsString()
  turn: string;

  @IsBoolean()
  state?: boolean = true;
}
