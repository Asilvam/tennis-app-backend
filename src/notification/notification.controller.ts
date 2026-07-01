import { Body, Controller, Post, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendToAllDto } from './dto/send-to-all.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  @Post('subscribe')
  async subscribe(@Body() subscription: CreateSubscriptionDto) {
    this.logger.log(`[notifications.subscribe] endpoint=${this.notificationService.maskEndpoint(subscription.endpoint)}`);
    return this.notificationService.saveSubscription(subscription);
  }

  @Post('send')
  async sendNotification(@Body() payload: SendNotificationDto) {
    return this.notificationService.sendNotification(payload);
  }

  // Nuevo endpoint para enviar notificaciones arbitrarias
  @Post('send-to-all')
  async sendToAll(@Body() message: SendToAllDto) {
    return this.notificationService.sendToAll(message);
  }
}
