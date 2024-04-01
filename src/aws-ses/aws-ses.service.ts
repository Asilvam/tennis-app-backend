import { Injectable, Logger } from '@nestjs/common';
import { SESClient, VerifyEmailIdentityCommand } from '@aws-sdk/client-ses';
import { SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import * as process from 'process';

@Injectable()
export class AwsSesService {
  private sesClient: SESClient;

  logger = new Logger(AwsSesService.name);

  constructor() {
    this.sesClient = new SESClient({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
      requestHandler: new NodeHttpHandler(),
    });
  }

  async sendEmail(to: string, subject: string, body: any): Promise<any> {
    const params: SendEmailCommandInput = {
      Source: 'clubtenisquintero1978@gmail.com',
      Destination: {
        ToAddresses: [to],
      },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: body.toString() } },
      },
    };
    try {
      const command = new SendEmailCommand(params);
      const result = await this.sesClient.send(command);
      this.logger.log('Email sent:', result.MessageId);
      return result.MessageId;
    } catch (error) {
      this.logger.error('Error sending email:', error);
      throw error;
    }
  }

  async verifyEmailIdentity(email: string) {
    try {
      const params = {
        EmailAddress: email,
      };
      const command = new VerifyEmailIdentityCommand(params);
      await this.sesClient.send(command);
    } catch (error) {
      this.logger.error('Error verifying email identity:', error);
      throw error;
    }
  }
}
