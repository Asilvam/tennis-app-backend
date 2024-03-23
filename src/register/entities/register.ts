import { Entity, Column, CreateDateColumn, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity()
export class Register {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  namePlayer: string;

  @Column()
  email: string;

  @Column()
  celular: string;

  @Column()
  pwd: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Column({ default: true })
  statePlayer: boolean;

  @Column({ default: 'user' })
  role: string;
}
