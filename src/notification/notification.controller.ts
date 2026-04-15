import { Body, Controller, Post, Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  @Post('subscribe')
  async subscribe(@Body() subscription: any) {
    this.logger.log(`subscription: ${JSON.stringify(subscription)}`);
    return this.notificationService.saveSubscription(subscription);
  }

  @Post('send')
  async sendNotification(@Body() payload: any) {
    return this.notificationService.sendNotification(payload);
  }

  // Nuevo endpoint para enviar notificaciones arbitrarias
  @Post('send-to-all')
  async sendToAll(@Body() message: any) {
    return this.notificationService.sendToAll(message);
  }
}
