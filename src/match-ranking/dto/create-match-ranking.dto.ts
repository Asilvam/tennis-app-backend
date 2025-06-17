import { IsString, IsNotEmpty } from 'class-validator';

export class CreateMatchRankingDto {
  @IsString()
  @IsNotEmpty()
  matchId: string;

  @IsString()
  @IsNotEmpty()
  result: string;

  @IsString()
  @IsNotEmpty()
  winner: string;
}
