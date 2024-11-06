import { Controller, Post, UploadedFile, UseInterceptors, HttpException, HttpStatus } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from './cloudinary.service';
import { Express } from 'express'; // Ensure Express is imported to use its types

@Controller('cloudinary')
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    // Multer.File should now be recognized
    console.log(file);
    if (!file) {
      throw new HttpException('File must be provided', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.cloudinaryService.uploadImage(file.path);
      return {
        message: 'Image uploaded successfully',
        url: result.secure_url,
        public_id: result.public_id,
      };
    } catch (error) {
      throw new HttpException(`Image upload failed: ${error.message}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
