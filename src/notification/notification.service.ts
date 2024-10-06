import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as webpush from 'web-push';

@Injectable()
export class NotificationService {
  private subscriptions: any[] = [];

  constructor() {
    webpush.setVapidDetails(
      'mailto:youremail@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
  }

  saveSubscription(subscription: any) {
    // Aquí puedes almacenar la suscripción en una base de datos.
    this.subscriptions.push(subscription);
    return { message: 'Subscription saved.' };
  }

  async sendNotification(payload: any) {
    const notificationPayload = {
      title: payload.title,
      body: payload.body,
    };

    const sendPromises = this.subscriptions.map((sub) => {
      return webpush.sendNotification(sub, JSON.stringify(notificationPayload));
    });

    try {
      await Promise.all(sendPromises);
      return { message: 'Notifications sent.' };
    } catch (error) {
      console.error('Error sending notification', error);
      return { message: 'Error sending notifications', error };
    }
  }

  async sendToAll(payload: any) {
    const notificationPayload = {
      title: payload.title || 'Default Title',
      body: payload.body || 'Default Body',
    };

    const sendPromises = this.subscriptions.map((sub) =>
      webpush.sendNotification(sub, JSON.stringify(notificationPayload)),
    );

    try {
      await Promise.all(sendPromises);
      return { message: 'Notifications sent to all users.' };
    } catch (error) {
      console.error('Error sending notifications', error);
      return { message: 'Error sending notifications', error };
    }
  }

  // Método general para enviar notificaciones a una suscripción específica
  async sendNotificationToSubscription(subscription: any, payload: any) {
    const notificationPayload = {
      title: payload.title || 'Notification Title',
      body: payload.body || 'Notification Body',
    };

    try {
      await webpush.sendNotification(subscription, JSON.stringify(notificationPayload));
      return { message: 'Notification sent.' };
    } catch (error) {
      console.error('Error sending notification', error);
      return { message: 'Error sending notification', error };
    }
  }

  // Enviar notificaciones a todos a las 9 AM todos los días
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sendDailyNotification() {
    const message = { title: 'Daily Update', body: 'Here is your daily notification!' };
    await this.sendToAll(message);
  }
}