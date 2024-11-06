import { Module } from '@nestjs/common';
import { InfoItemsService } from './info-items.service';
import { InfoItemsController } from './info-items.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { InfoItem, InfoItemSchema } from './entities/info-item.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: InfoItem.name, schema: InfoItemSchema }])],
  controllers: [InfoItemsController],
  providers: [InfoItemsService, CloudinaryService],
})
export class InfoItemsModule {}
