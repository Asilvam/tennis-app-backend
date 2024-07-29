import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly resendClient: any;
  private readonly logger = new Logger(EmailService.name);

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('Resend API key is not defined');
    }
    this.resendClient = new Resend(apiKey);
  }

  async sendEmail(to: string, subject: string, body: string): Promise<string> {
    const params = {
      from: 'LL Lawn Tennis <tennis_reserve@resend.dev>',
      to: [to],
      subject: subject,
      text: body,
    };

    try {
      const result = await this.resendClient.emails.send(params);
      if (!result) {
        this.logger.log('Email sent:', result.data.id);
        return result.data.id;
      }
    } catch (error: any) {
      this.logger.error('Error sending email:', error.message);
      throw error;
    }
  }
}
