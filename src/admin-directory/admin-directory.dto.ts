import { Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class DirectoryQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsIn([25, 50, 100]) pageSize = 25;
}

export class MembersDirectoryQueryDto extends DirectoryQueryDto {
  @IsOptional() @IsIn(['active', 'inactive']) state?: string;
  @IsOptional() @IsIn(['Titular', 'Carga']) memberType?: string;
  @IsOptional() @IsIn(['allowed', 'blocked']) access?: string;
}

export class TitularesDirectoryQueryDto {
  @IsOptional() @IsMongoId() excludeId?: string;
  @IsOptional() @IsMongoId() currentId?: string;
}

export class ReservesDirectoryQueryDto extends DirectoryQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['Cancha 1', 'Cancha 2', 'Cancha 3']) court?: string;
  @IsOptional()
  @IsIn([
    '08:15-10:00',
    '10:15-12:00',
    '12:15-14:00',
    '14:15-16:00',
    '16:15-18:00',
    '18:15-20:00',
    '20:15-22:00',
    '22:15-00:00',
  ])
  turn?: string;
}
