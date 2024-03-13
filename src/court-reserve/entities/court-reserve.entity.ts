import {Entity, Column, PrimaryGeneratedColumn, ObjectIdColumn} from 'typeorm';
import {ObjectId} from "mongodb";

@Entity()
export class CourtReserve {
    @ObjectIdColumn()
    id: ObjectId;

    @Column()
    courtNumber: number;

    @Column()
    player1: string;

    @Column()
    player2: string;

    @Column()
    dateToPlay: Date;

    @Column()
    Turn: number;

    @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    reservedAt: Date;
}
