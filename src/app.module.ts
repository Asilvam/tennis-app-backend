import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { DatabaseModule } from './database/database.module';
import { RegisterModule } from './register/register.module';

@Module({
  imports: [
      UsersModule,
    DatabaseModule,
    RegisterModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
