import {
  Controller,
  Get,
  Post,
  Body,
  // Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { AuthService } from './auth.service';
// import { CreateAuthDto } from './dto/create-auth.dto';
// import { UpdateAuthDto } from './dto/update-auth.dto';
import { JwtService } from '../jwt/jwt.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  @Post()
  create(@Body() createAuthDto: any) {
    return this.authService.validate(createAuthDto);
  }

  @Post('login')
  async login(@Body() loginDto: any) {
    const register = await this.authService.findRegisterByUsername(
      loginDto.username,
    );
    if (!register) {
      return {
        statusCode: 400,
        message: 'User not found',
      };
    }

    const isPasswordValid = await this.authService.comparePasswords(
      loginDto.password,
      register.pwd,
    );
    if (!isPasswordValid) {
      return {
        statusCode: 401,
        message: 'access denied',
      };
    }
    // Generate JWT token
    const accessToken = this.jwtService.generateToken({
      username: register.namePlayer,
    });
    if (accessToken) {
      return { message: 'Login successful', accessToken: accessToken };
    }
  }

  @Get()
  findAll() {
    return this.authService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.authService.findOne(+id);
  }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateAuthDto: UpdateAuthDto) {
  //   return this.authService.update(+id, updateAuthDto);
  // }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.authService.remove(+id);
  }
}
