import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
    constructor(private readonly mailerService: MailerService) {}

    async sendEmail(email: string, subject: string, template: string, context: any) {
        await this.mailerService.sendMail({
            to: email,
            subject,
            template,
            context,
        });
    }
}
