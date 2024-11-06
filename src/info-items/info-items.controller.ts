import { Controller, Get, Post, Body, Patch, Param, Delete, UseInterceptors, UploadedFile } from '@nestjs/common';
import { InfoItemsService } from './info-items.service';
import { CreateInfoItemDto } from './dto/create-info-item.dto';
import { UpdateInfoItemDto } from './dto/update-info-item.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('info-items')
export class InfoItemsController {
  constructor(
    private readonly infoItemsService: InfoItemsService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('image'))
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
    @Body('text') text: string,
  ) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    try {
      const uploadedImage = await this.cloudinaryService.uploadImageBuffer(file.buffer); // Ensure file.path is correct
      return this.infoItemsService.create({ title, content: text, imageUrl: uploadedImage.secure_url });
    } catch (error) {
      throw new Error(`Failed to upload image to Cloudinary: ${error.message}`);
    }
  }

  @Get()
  findAll() {
    return this.infoItemsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.infoItemsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInfoItemDto: UpdateInfoItemDto) {
    return this.infoItemsService.update(+id, updateInfoItemDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.infoItemsService.remove(id);
  }
}
