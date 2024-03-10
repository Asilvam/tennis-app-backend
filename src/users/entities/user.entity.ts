import {Entity, ObjectIdColumn, Column, CreateDateColumn} from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity()
export class UserEntity {
    @ObjectIdColumn()
    id: ObjectId;

    @Column()
    firstName: string;

    @Column()
    lastName: string;

    @Column()
    email: string;

    @CreateDateColumn({ type: 'timestamp' })
    created_at: Date;

    @Column()
    stateUser: boolean;

    @Column()
    role: string;

    constructor() {
        this.stateUser = true;
        this.role = 'user';
    }
    // Other properties and methods can be defined as needed
}
