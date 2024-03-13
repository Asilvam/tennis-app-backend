import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtService {
    private readonly secretKey: string = '5:Cc9nd"ViI_</1~FLvEQ\'|v4<aKih'; // Change this to your secret key

    generateToken(payload: any): string {
        return jwt.sign(payload, this.secretKey);
    }
}
