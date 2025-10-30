import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';

@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: async (config: ConfigService) => {
        const port = parseInt(config.get('MAIL_PORT'), 10);
        const secure = config.get('MAIL_SECURE') === 'true';

        // Validar configuración coherente
        if (port === 465 && !secure) {
          throw new Error('Puerto 465 requiere MAIL_SECURE=true');
        }
        if (port === 587 && secure) {
          throw new Error('Puerto 587 requiere MAIL_SECURE=false');
        }

        return {
          transport: {
            host: config.get('MAIL_HOST'),
            pool: true,
            port,
            secure,
            auth: {
              user: config.get('MAIL_USER'),
              pass: config.get('MAIL_PASSWORD'),
            },
          },
          defaults: {
            from: `"Club de Tenis Quintero APP" <${config.get('MAIL_FROM')}>`,
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
