import { Entity, ObjectId, ObjectIdColumn, Column } from 'typeorm';

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

    @Column()
    created_at: Date;


    // Other properties and methods can be defined as needed
}
