import {
  Entity,
  Column,
  CreateDateColumn,
  ObjectIdColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ObjectId } from 'mongodb';
import { Role } from '../../common/enums/rol.enum';

@Entity()
export class Register {
  @ObjectIdColumn()
  id: ObjectId;

  @Column()
  namePlayer: string;

  @Column({ unique: true, nullable: false })
  email: string;

  @Column()
  cellular: string;

  @Column({ nullable: false, select: false })
  pwd: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Column({ default: true })
  statePlayer: boolean;

  @Column({ type: 'enum', default: Role.USER, enum: Role })
  role: Role;

  @DeleteDateColumn()
  deletedAt: Date;
}
