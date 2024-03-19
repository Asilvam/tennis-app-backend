import {Module} from '@nestjs/common';
import {RegisterService} from './register.service';
import {RegisterController} from './register.controller';
import {TypeOrmModule} from "@nestjs/typeorm";
import {Register} from "./entities/register";
import {MailService} from "../mail/mail.service";
import {AwsSesService} from "../aws-ses/aws-ses.service";

@Module({
    controllers: [RegisterController],
    providers: [RegisterService, AwsSesService],
    imports: [TypeOrmModule.forFeature([Register])],
})
export class RegisterModule {
}
