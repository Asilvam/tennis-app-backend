import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';
import {RegisterEntity} from "../register/entities/register.entity";
import {Court} from "../court/entities/court.entity";
import {Turn} from "../turn/entities/turn.entity"; // Import your entity

@Module({
    imports: [
        TypeOrmModule.forRoot({
            type: 'mongodb',
            host: 'localhost',
            port: 27017,
            database: 'tennis_app',
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
