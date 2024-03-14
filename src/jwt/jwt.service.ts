import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import * as process from "process";

@Injectable()
export class JwtService {
    private readonly secretKey: string = process.env.SECRET_KEY; // Change this to your secret key

    generateToken(payload: any): string {
        return jwt.sign(payload, this.secretKey);
    }
}
