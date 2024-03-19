import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';
import {Register} from "../register/entities/register";
import {Court} from "../court/entities/court.entity";
import {Turn} from "../turn/entities/turn.entity";
import {CourtReserve} from "../court-reserve/entities/court-reserve.entity";

@Module({
    imports: [
        TypeOrmModule.forRoot({
            type: 'mongodb',
            url: 'mongodb+srv://admin:admin@cluster0.jim6x.mongodb.net/Tennis?retryWrites=true&w=majority&appName=Cluster0',
            // url: process.env.MONGODB_URL,
            database: 'Tennis',
            entities: [
                Court,
                Turn,
                Register,
                CourtReserve,
            ],
            synchronize: true,
            useNewUrlParser: true,
            useUnifiedTopology: true,
        }),
    ],
    exports: [TypeOrmModule],
})
export class DatabaseModule {
}
