import { Logger, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RegisterSchema } from '../register/entities/register.entity';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGODB_URI, // Connection URI for MongoDB
        dbName: 'Tennis', // Database name
      }),
    }),
  ],
  providers: [Logger],
  exports: [MongooseModule],
})
export class DatabaseModule {
  constructor(private readonly logger: Logger) {}

  async onModuleInit() {
    this.logger.log(`Connected to MongoDB database`);
  }
}
