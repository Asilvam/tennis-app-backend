import { Prop, Schema } from '@nestjs/mongoose';

@Schema({ collection: 'match_ranking', timestamps: true })
export class MatchRanking {
  @Prop({
    required: true,
    unique: true,
  })
  idCourtReserve: string;







}
