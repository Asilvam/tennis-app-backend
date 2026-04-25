import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NewsCTQService } from './news-ctq.service';
import { NewsCTQ, NewsCTQSchema } from './entities/news-ctq.entity';

@Module({
  imports: [MongooseModule.forFeature([{ name: NewsCTQ.name, schema: NewsCTQSchema }])],
  providers: [NewsCTQService],
  exports: [NewsCTQService],
})
export class NewsCTQModule {}
