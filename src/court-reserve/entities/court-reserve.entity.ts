import { Entity, Column, ObjectIdColumn, CreateDateColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity()
export class CourtReserve {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  court: string;

  @Column()
  player1: string;

  @Column()
  player2: string;

  @Column()
  dateToPlay: string;

  @Column()
  turn: string;

  @Column({ default: true })
  state: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
