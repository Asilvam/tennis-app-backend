import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NewsCTQService } from './news-ctq.service';
import { NewsCTQController } from './news-ctq.controller';
import { NewsCTQ, NewsCTQSchema } from './entities/news-ctq.entity';

@Module({
  imports: [MongooseModule.forFeature([{ name: NewsCTQ.name, schema: NewsCTQSchema }])],
  controllers: [NewsCTQController],
  providers: [NewsCTQService],
  exports: [NewsCTQService],
})
export class NewsCTQModule {}
