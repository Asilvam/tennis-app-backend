import {Column, Entity, ObjectIdColumn, PrimaryGeneratedColumn} from "typeorm";
import {ObjectId} from "mongodb";

@Entity()
export class Turn {
    @ObjectIdColumn()
    id: ObjectId;

    @Column()
    turnNumber: number;

    @Column()
    state: boolean;

    @Column()
    description: string;

}
