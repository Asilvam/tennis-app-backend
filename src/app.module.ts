import {Module} from '@nestjs/common';
import {AppController} from './app.controller';
import {AppService} from './app.service';
import {UsersModule} from './users/users.module';
import {DatabaseModule} from './database/database.module';
import {RegisterModule} from './register/register.module';
import {AuthModule} from './auth/auth.module';
import {JwtService} from './jwt/jwt.service';

@Module({
    imports: [
        UsersModule,
        DatabaseModule,
        RegisterModule,
        AuthModule],
    controllers: [AppController],
    providers: [AppService, JwtService],
})
export class AppModule {
}
