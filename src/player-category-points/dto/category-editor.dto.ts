import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Category } from '../../register/enums/category.enum';

export class CategoryPointsAdjustmentDto {
  @IsIn(Object.values(Category))
  category: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  points: number;
}

export class SaveCategoryAssignmentsDto {
  @Matches(/^[a-f0-9]{64}$/)
  revision: string;

  @IsArray()
  @ArrayMaxSize(Object.values(Category).length)
  @ArrayUnique()
  @IsIn(Object.values(Category), { each: true })
  activeCategories: string[];

  @IsArray()
  @ArrayMaxSize(Object.values(Category).length)
  @ArrayUnique((item: CategoryPointsAdjustmentDto) => item?.category)
  @ValidateNested({ each: true })
  @Type(() => CategoryPointsAdjustmentDto)
  pointAdjustments: CategoryPointsAdjustmentDto[];
}

export class CategoryNameDto {
  @IsIn(Object.values(Category))
  category: string;
}

export class LegacyCategoryUpdateDto extends CategoryPointsAdjustmentDto {
  @IsBoolean()
  isActive: boolean;
}

export class LegacyCategoryUpdatesDto {
  @IsArray()
  @ArrayMaxSize(Object.values(Category).length)
  @ArrayUnique((item: LegacyCategoryUpdateDto) => item?.category)
  @ValidateNested({ each: true })
  @Type(() => LegacyCategoryUpdateDto)
  categories: LegacyCategoryUpdateDto[];
}
