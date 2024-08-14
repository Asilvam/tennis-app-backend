import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Auth } from "./decorators/auth.decorator";
import { Role } from "../common/enums/rol.enum";
import { ActiveUser } from "../common/decorators/active-user.decorator";
import { UserActiveInterface } from "../common/interfaces/user-active.interface";
import { TokenDto } from "./dto/token.dto";

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Get('profile')
  @Auth(Role.USER)
  profile(@ActiveUser() user: UserActiveInterface) {
    return this.authService.profile(user);
  }

  @Post('refresh')
  refresh(@Body() dto: TokenDto) {
    return this.authService.refreshToken(dto.token);
  }

  @Post('logout')
  async logout(@Body('refreshToken') refreshToken: string) {
    await this.authService.revokeRefreshToken(refreshToken);
    return { message: 'Logged out successfully' };
  }
}
