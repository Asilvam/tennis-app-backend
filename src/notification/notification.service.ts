import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as webpush from 'web-push';
import * as process from 'node:process';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription } from './entities/notification-subscription';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { SendToAllDto } from './dto/send-to-all.dto';

type NotificationSummary = {
  message: string;
  total: number;
  sent: number;
  failed: number;
  removedInvalid: number;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel('Subscription')
    private readonly subscriptionModel: Model<Subscription>,
  ) {
    webpush.setVapidDetails(`mailto:${process.env.MAIL_USER}`, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }

  maskEndpoint(endpoint: string): string {
    if (!endpoint) {
      return 'unknown';
    }
    return endpoint.length <= 10 ? endpoint : `${endpoint.slice(0, 6)}...${endpoint.slice(-4)}`;
  }

  async saveSubscription(subscription: CreateSubscriptionDto) {
    const saved = await this.subscriptionModel
      .findOneAndUpdate(
        { endpoint: subscription.endpoint },
        { $set: { keys: subscription.keys } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    this.logger.log(`[notifications.subscribe] saved endpoint=${this.maskEndpoint(subscription.endpoint)}`);
    return saved;
  }

  async sendNotification(payload: SendNotificationDto): Promise<NotificationSummary> {
    this.logger.log('[notifications.send] Sending notification to all stored subscriptions');
    return this._sendToStoredSubscriptions({ title: payload.title, body: payload.body });
  }

  async sendToAll(payload: SendToAllDto): Promise<NotificationSummary> {
    this.logger.log('[notifications.sendToAll] Sending broadcast notification to all stored subscriptions');
    const notificationPayload = {
      title: payload.title || 'Default Title',
      body: payload.body || 'Default Body',
    };

    return this._sendToStoredSubscriptions(notificationPayload);
  }

  // Metodo general para enviar notificaciones a una suscripcion especifica
  async sendNotificationToSubscription(subscription: CreateSubscriptionDto, payload: SendToAllDto) {
    const notificationPayload = {
      title: payload.title || 'Notification Title',
      body: payload.body || 'Notification Body',
    };

    const endpointMasked = this.maskEndpoint(subscription?.endpoint);

    try {
      await webpush.sendNotification(subscription as any, JSON.stringify(notificationPayload));
      return { message: 'Notification sent.' };
    } catch (error) {
      const webPushError = error as { statusCode?: number; message?: string; stack?: string };
      if (this._isInvalidSubscriptionError(webPushError)) {
        await this.subscriptionModel.deleteOne({ endpoint: subscription.endpoint }).exec();
      }
      this.logger.error(`[notifications.sendOne] Error endpoint=${endpointMasked}: ${webPushError?.message || 'unknown error'}`, webPushError?.stack);
      return { message: 'Error sending notification' };
    }
  }

  private async _sendToStoredSubscriptions(payload: { title: string; body: string }): Promise<NotificationSummary> {
    const subscriptions = await this.subscriptionModel.find().lean().exec();
    const total = subscriptions.length;

    if (total === 0) {
      return {
        message: 'No subscriptions found.',
        total,
        sent: 0,
        failed: 0,
        removedInvalid: 0,
      };
    }

    let sent = 0;
    let failed = 0;
    let removedInvalid = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(sub as any, JSON.stringify(payload));
        sent += 1;
      } catch (error) {
        failed += 1;
        const webPushError = error as { statusCode?: number; message?: string; stack?: string };
        const endpoint = (sub as any)?.endpoint;
        const endpointMasked = this.maskEndpoint(endpoint);

        if (this._isInvalidSubscriptionError(webPushError)) {
          await this.subscriptionModel.deleteOne({ endpoint }).exec();
          removedInvalid += 1;
          this.logger.warn(`[notifications.send] Removed invalid subscription endpoint=${endpointMasked} status=${webPushError?.statusCode}`);
          continue;
        }

        this.logger.error(`[notifications.send] Error endpoint=${endpointMasked}: ${webPushError?.message || 'unknown error'}`, webPushError?.stack);
      }
    }

    return {
      message: 'Notifications processed.',
      total,
      sent,
      failed,
      removedInvalid,
    };
  }

  private _isInvalidSubscriptionError(error: { statusCode?: number } | undefined): boolean {
    return error?.statusCode === 404 || error?.statusCode === 410;
  }

  // Enviar notificaciones a todos a las 9 AM todos los días
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendDailyNotification() {
    const message = { title: 'Daily Update', body: 'Here is your daily notification!' };
    await this.sendToAll(message);
  }
}
