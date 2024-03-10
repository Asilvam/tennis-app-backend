import { Entity, Column, CreateDateColumn, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity()
export class RegisterEntity {
    @ObjectIdColumn()
    id: ObjectId;

    @Column()
    user: string;

    @Column()
    pwd: string;

    @CreateDateColumn({ type: 'timestamp' })
    created_at: Date;

}
