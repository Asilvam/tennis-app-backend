import {Injectable} from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as aws from 'aws-sdk';
import {SentMessageInfo} from 'nodemailer';
import {VerifyEmailIdentityCommand} from "@aws-sdk/client-ses";
import {SESClient} from "@aws-sdk/client-ses";


@Injectable()
export class AwsSesService {
    private transporter: nodemailer.Transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            SES: new aws.SES({apiVersion: '2010-12-01', region: 'us-east-1'}),
        });
    }

    async sendEmail(to: string, subject: string, body: any): Promise<SentMessageInfo> {
        const options: nodemailer.SendMailOptions = {
            from: 'clubtenisquintero1978@gmail.com',
            to,
            subject,
            text: body.toString(), // Convert body to string
        };
        try {
            const info = await this.transporter.sendMail(options);
            console.log('Email sent:', info.messageId);
            return info;
        } catch (error) {
            console.error('Error sending email:', error);
            throw error;
        }
    }

    async verifyEmailIdentity(email: string) {
        const REGION = "us-east-1";
        const sesClient = new SESClient({region: REGION});
        try {
            const params = {
                EmailAddress: email,
            };
            const command = new VerifyEmailIdentityCommand(params);
            await sesClient.send(command);
        } catch (error) {
            console.error('Error verifying email identity:', error);
            throw error;
        }
    }
}
