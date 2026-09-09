import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MAIL_PROVIDER, type IMailProvider } from './mail-provider.interface';
import { SendGridService } from '../sendgrid/sendgrid.service';
import { MailgunService } from '../mailgun/mailgun.service';

type MailProviderConstructor = new (config: ConfigService) => IMailProvider;

const SUPPORTED_PROVIDERS: Record<string, MailProviderConstructor> = {
  sendgrid: SendGridService,
  mailgun: MailgunService,
};

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): IMailProvider => {
        const name = config.get<string>('MAIL_PROVIDER_NAME', 'mailgun');
        const ProviderClass = SUPPORTED_PROVIDERS[name];
        if (!ProviderClass) {
          const available = Object.keys(SUPPORTED_PROVIDERS).join(', ');
          throw new Error(`Unknown MAIL_PROVIDER_NAME="${name}". Supported: ${available}`);
        }
        return new ProviderClass(config);
      },
    },
  ],
  exports: [MAIL_PROVIDER],
})
export class MailProviderModule {}
