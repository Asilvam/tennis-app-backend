import { Module } from '@nestjs/common';
import { InfoItemsService } from './info-items.service';
import { InfoItemsController } from './info-items.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { InfoItem, InfoItemSchema } from './entities/info-item.entity';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: InfoItem.name, schema: InfoItemSchema }]),
    CloudinaryModule,
  ],
  controllers: [InfoItemsController],
  providers: [InfoItemsService],
})
export class InfoItemsModule {}
