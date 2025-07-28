import { Controller, Post, Body } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('send')
  async sendMessage(@Body('to') to: string, @Body('message') message: string) {
    await this.whatsappService.sendMessage(to, message);
    return { status: 'Message sent', to, message };
  }

  @Post('sendgroup')
  async sendGroupMessage(@Body('groupId') groupId: string, @Body('message') message: string) {
    await this.whatsappService.sendGroupMessage(groupId, message);
    return { status: 'Message sent', groupId, message };
  }
}
