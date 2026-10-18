import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsMongoId } from 'class-validator';

export class SelectMembershipDuesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsMongoId({ each: true })
  dueIds: string[];
}
