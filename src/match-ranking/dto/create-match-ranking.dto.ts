import { IsString, IsBoolean, IsOptional, IsNotEmpty, IsDateString } from 'class-validator';

export class CreateMatchRankingDto {
  @IsString()
  @IsNotEmpty()
  matchId: string;

  @IsString()
  @IsNotEmpty()
  player1: string;

  @IsString()
  @IsNotEmpty()
  player2: string;

  @IsOptional()
  @IsString()
  player3?: string;

  @IsOptional()
  @IsString()
  player4?: string;

  @IsBoolean()
  isDoubles: boolean;

  @IsString()
  @IsNotEmpty()
  result: string;

  @IsString()
  @IsNotEmpty()
  winner: string;

  @IsOptional()
  @IsDateString()
  matchDate?: Date;
}