import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateInfoItemDto {
  @IsOptional()
  @IsBoolean()
  state?: boolean;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsNotEmpty()
  @IsString()
  imageUrl: string;
}
