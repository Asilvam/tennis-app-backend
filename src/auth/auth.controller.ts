import { Controller, Post, Body, Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { TokenDto } from './dto/token.dto';

@Controller('auth')
export class AuthController {
  logger = new Logger(AuthController.name);
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refreshToken')
  refreshToken(@Body() dto: TokenDto) {
    return this.authService.refreshToken(dto.token);
  }

  @Post('validateToken')
  validateToken(@Body() token: TokenDto) {
    return this.authService.validateToken(token);
  }
}
