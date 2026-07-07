import { IsString, IsIn, IsOptional } from 'class-validator';
import { Category, MatchType } from '../enums/category.enum';

/**
 * DTO para remover una categoría de un jugador
 */
export class RemovePlayerCategoryDto {
  @IsString()
  @IsIn(Object.values(Category))
  category: string; // '1', '2', '3', '4', 'Damas', '+55', etc.

  @IsOptional()
  @IsString()
  @IsIn(Object.values(MatchType))
  matchType?: string; // 'singles' o 'doubles' (opcional: si no se especifica, elimina ambos)
}

