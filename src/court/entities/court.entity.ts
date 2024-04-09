import { Column, Entity, ObjectIdColumn } from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity()
export class Court {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  courtNumber: number;

  @Column()
  state: boolean;

  @Column()
  description: string;
}
