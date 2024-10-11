import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCourtReserveDto {
  @IsNotEmpty()
  @IsString()
  court: string;

  @IsNotEmpty()
  @IsString()
  player1: string;

  @IsOptional()
  @IsString()
  player2?: string;

  @IsNotEmpty()
  @IsDateString()
  dateToPlay: string;

  @IsNotEmpty()
  @IsString()
  turn: string;

  @IsOptional()
  @IsBoolean()
  state?: boolean;

  @IsOptional()
  @IsString()
  player3?: string;

  @IsOptional()
  @IsString()
  player4?: string;

  @IsOptional()
  @IsBoolean()
  isPaidNight?: boolean;

  @IsOptional()
  @IsBoolean()
  isDouble?: boolean;

  @IsOptional()
  @IsBoolean()
  isVisit?: boolean;

  @IsOptional()
  @IsString()
  visitName?: string;

  @IsOptional()
  @IsBoolean()
  isForRanking?: boolean;
}
