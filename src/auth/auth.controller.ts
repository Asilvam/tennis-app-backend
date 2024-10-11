import { Query, Controller, Post, Body, Logger, Get, BadRequestException, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { TokenDto } from './dto/token.dto';
import { Response } from 'express';
import * as process from 'node:process';

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

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Res() res: Response) {
    const user = await this.authService.verifyEmailToken(token);

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    // HTML response for successful verification
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Email Verified</title>
          <style>
              body {
                  font-family: Arial, sans-serif;
                  background-color: #f4f4f4;
                  margin: 0;
                  padding: 0;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  height: 100vh;
              }
              .container {
                  text-align: center;
                  background-color: white;
                  padding: 30px;
                  border-radius: 10px;
                  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
              }
              h1 {
                  color: #4CAF50;
              }
              p {
                  font-size: 18px;
                  color: #333;
              }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>Email Verified Successfully!</h1>
              <p>Your email has been successfully verified. You can now log in with your account.</p>
              <a href="${process.env.HOME_FRONT}/" style="color: #4CAF50; text-decoration: none; font-size: 18px;">
              Go to Homepage
              </a>
          </div>
      </body>
      </html>
    `;

    // Return the HTML content as a response
    res.setHeader('Content-Type', 'text/html');
    return res.send(htmlContent);
  }
}
