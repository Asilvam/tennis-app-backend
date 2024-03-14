import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';
import {RegisterEntity} from "../register/entities/register.entity";
import {Court} from "../court/entities/court.entity";
import {Turn} from "../turn/entities/turn.entity";

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
                RegisterEntity,// Add other entities here if needed
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
