import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateMatchRankingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  matchId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(64)
  @Matches(/^\d{1,2}[:\-]\d{1,2}(?:\(\d{1,2}\))?(?:,\s*\d{1,2}[:\-]\d{1,2}(?:\(\d{1,2}\))?){0,2}$/, {
    message: 'Ingresa un marcador por sets, por ejemplo 6:4, 6:3.',
  })
  result: string;

  @IsIn(['A', 'B'])
  winnerSide: 'A' | 'B';

  @IsOptional()
  @IsBoolean()
  allowExpired?: boolean;
}
