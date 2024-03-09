import {Module} from '@nestjs/common';
import {TypeOrmModule} from '@nestjs/typeorm';
import {UserEntity} from '../users/entities/user.entity'
import {RegisterEntity} from "../register/entities/register.entity"; // Import your entity

@Module({
    imports: [
        TypeOrmModule.forRoot({
            type: 'mongodb',
            host: 'localhost',
            port: 27017,
            database: 'tennis_app',
            entities: [
                UserEntity,
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
