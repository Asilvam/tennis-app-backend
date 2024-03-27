import { Controller, Post, Body } from '@nestjs/common';
import { AwsSesService } from '../aws-ses/aws-ses.service';

@Controller('email')
export class EmailController {
  constructor(private readonly awsSesService: AwsSesService) {}

  @Post('send')
  async sendEmail(
    @Body() emailDto: { to: string; subject: string; body: string },
  ) {
    const { to, subject, body } = emailDto;
    try {
      const result = await this.awsSesService.sendEmail(to, subject, body);
      return { messageId: result.messageId };
    } catch (error) {
      return { error: error.message };
    }
  }

  @Post('sendVerification')
  async sendVerification(@Body() { email }: { email: string }) {
    try {
      const result = await this.awsSesService.verifyEmailIdentity(email);
      return result;
    } catch (error) {
      return { error: error.message };
    }
  }
}
