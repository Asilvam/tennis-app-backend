import { Controller, Get, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AdminDirectoryService } from './admin-directory.service';
import { MembersDirectoryQueryDto, ReservesDirectoryQueryDto, TitularesDirectoryQueryDto } from './admin-directory.dto';

@Controller('admin-directory')
@UseGuards(JwtAuthGuard, AdminGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class AdminDirectoryController {
  constructor(private readonly directory: AdminDirectoryService) {}

  @Get('members')
  members(@Req() request: { user: { email: string } }, @Query() query: MembersDirectoryQueryDto) {
    return this.directory.listMembers(request.user.email, query);
  }

  @Get('titulares')
  titulares(@Req() request: { user: { email: string } }, @Query() query: TitularesDirectoryQueryDto) {
    return this.directory.titulares(request.user.email, query.excludeId, query.currentId);
  }

  @Get('reserves')
  reserves(@Req() request: { user: { email: string } }, @Query() query: ReservesDirectoryQueryDto) {
    return this.directory.listReserves(request.user.email, query);
  }
}
