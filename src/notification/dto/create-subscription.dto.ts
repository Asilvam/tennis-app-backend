import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class SubscriptionKeysDto {
  @ApiProperty({
    description: 'Clave pública criptográfica de la suscripción Web Push',
    example: 'BIPJFO876asdjASDhhasd876ASDJH876asdjKHASDKJasd876asd...',
  })
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @ApiProperty({
    description: 'Secreto de autenticación Web Push',
    example: 'kZasd876ASDJasdjh123...',
  })
  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class CreateSubscriptionDto {
  @ApiProperty({
    description: 'URL de suscripción Web Push única del navegador del usuario',
    example: 'https://fcm.googleapis.com/fcm/send/ez8-asd...',
  })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({
    description: 'Llaves de cifrado criptográfico asociadas al cliente',
    type: SubscriptionKeysDto,
  })
  @ValidateNested()
  @Type(() => SubscriptionKeysDto)
  keys: SubscriptionKeysDto;
}

