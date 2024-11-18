import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Chat, Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private client: Client;

  logger = new Logger('WhatsappService');

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      // puppeteer: { headless: true },
    });

    // Generate a QR code for authentication
    this.client.on('qr', (qr) => {
      qrcode.generate(qr, { small: true });
      this.logger.log('QR code received, scan with WhatsApp');
    });

    this.client.on('ready', async () => {
      this.logger.log('WhatsApp Web client is ready!');

      // Listar todos los chats y obtener los IDs de los grupos
      const chats: Chat[] = await this.client.getChats();
      const groups = chats.filter((chat) => chat.isGroup);

      groups.forEach((group) => {
        this.logger.log(`Grupo encontrado: ${group.name}, ID: ${group.id._serialized}`);
      });
    });

    this.client.on('auth_failure', (msg) => {
      this.logger.error('Authentication failure:', msg);
    });

    this.client.on('disconnected', (reason) => {
      this.logger.log('WhatsApp client was logged out:', reason);
      this.client.initialize();
    });
  }

  async onModuleInit() {
    await this.client.initialize();
  }

  async sendMessage(to: string, message: string): Promise<void> {
    try {
      this.logger.log(`Sending message to: ${to} with content: ${message}`);
      await this.client.sendMessage(to, message);
      // this.logger.log('Message response:', { response });
      this.logger.log('Message sent successfully');
    } catch (error) {
      this.logger.error('Failed to send message:', error);
    }
  }

  async sendGroupMessage(groupId: string, message: string) {
    try {
      this.logger.log(`Sending message to group: ${groupId} with content: ${message}`);
      await this.client.sendMessage(groupId, message);
      this.logger.log('Message sent successfully to the group!');
    } catch (error) {
      this.logger.error('Failed to send message to group:', error);
    }
  }
}
