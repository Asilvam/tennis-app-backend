import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Register } from '../register/entities/register';
import { Court } from '../court/entities/court.entity';
import { Turn } from '../turn/entities/turn.entity';
import { CourtReserve } from '../court-reserve/entities/court-reserve.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'mongodb',
        url: process.env.MONGODB_URI,
        database: 'Tennis',
        entities: [Court, Turn, Register, CourtReserve],
        synchronize: true,
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }),
    }),
  ],
  providers: [Logger],
  exports: [TypeOrmModule],
})
export class DatabaseModule {
  constructor(private readonly logger: Logger) {}

  async onModuleInit() {
    this.logger.log(`Connected to MongoDB database`);
  }
}
