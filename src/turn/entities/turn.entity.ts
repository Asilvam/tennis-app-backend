import {
  Column,
  Entity,
  ObjectIdColumn,
} from 'typeorm';
import { ObjectId } from 'mongodb';

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
