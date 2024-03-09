import {Entity, Column, PrimaryGeneratedColumn, ObjectIdColumn, ObjectId} from 'typeorm';

@Entity()
export class RegisterEntity {
    @ObjectIdColumn()
    id: ObjectId;

    @Column()
    user: string;

    @Column()
    pwd: string;

    @Column()
    created_at: Date;

    @Column({default: 'user'})
    roles: string

}
