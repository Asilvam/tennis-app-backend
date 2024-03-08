import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class RegisterEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    user: string;

    @Column()
    pwd: string;
}
