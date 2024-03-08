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

    // Other properties and methods can be defined as needed
}
