import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';

@Injectable()
export class WhatsappService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappService.name);
  private client: Client;
  private isClientReady = false; // <-- 1. Estado para saber si el cliente está listo

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        args: ['--no-sandbox'], // Necesario para correr en muchos entornos de servidor
      },
    });
  }

  // Usamos OnModuleInit para que la inicialización comience cuando el módulo se carga
  onModuleInit() {
    this.initializeClient();
  }

  private initializeClient() {
    this.client.on('qr', (qr) => {
      this.logger.log('QR Code received, please scan:', qr);
      // Aquí puedes usar una librería como 'qrcode-terminal' para mostrar el QR en la consola
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      this.isClientReady = true; // <-- 2. Marcamos el cliente como listo
      this.logger.log('WhatsApp client is ready!');
    });

    this.client.on('auth_failure', (msg) => {
      this.logger.error('Authentication failure:', msg);
    });

    this.client.initialize().catch((err) => {
      this.logger.error('Failed to initialize WhatsApp client', err);
    });
  }

  async sendGroupMessage(groupId: string, message: string) {
    // 3. Verificamos el estado antes de intentar enviar el mensaje
    if (!this.isClientReady) {
      this.logger.warn('Attempted to send message, but client is not ready.');
      // Lanza una excepción HTTP 503 (Servicio No Disponible)
      throw new ServiceUnavailableException('WhatsApp client is not ready yet. Please try again in a moment.');
    }

    try {
      this.logger.log(`Sending message to group: ${groupId} with content: ${message}`);
      await this.client.sendMessage(groupId, message);
    } catch (error) {
      this.logger.error(`Failed to send message to group:`, error);
      // Relanza el error o lanza una excepción personalizada
      throw new Error(`Could not send message to group ${groupId}`);
    }
  }

  // También deberías añadir la misma lógica de verificación a sendMessage
  async sendMessage(to: string, message: string) {
    if (!this.isClientReady) {
      throw new ServiceUnavailableException('WhatsApp client is not ready yet.');
    }
    // ... resto de la lógica
    await this.client.sendMessage(to, message);
  }
}
