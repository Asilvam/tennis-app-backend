import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateMultipleBookingDto } from './dto/create-multiple-booking.dto';
import { Booking } from './booking.interface';
import { CourtReserveService } from '../court-reserve/court-reserve.service';
import { RegisterService } from '../register/register.service';

type BookingActor = {
  email: string;
  role: string;
};

@Injectable()
export class BookingService {
  constructor(
    private readonly courtReserveService: CourtReserveService,
    private readonly registerService: RegisterService,
  ) {}

  async createMultiple(dto: CreateMultipleBookingDto, actor: BookingActor) {
    const { courts, dates, turns } = dto;
    const motive = await this.resolveMotive(dto.motive, actor);
    const newBookings: Booking[] = [];
    courts.forEach((court) => {
      dates.forEach((date) => {
        turns.forEach((turn) => {
          const booking = {
            court,
            dateToPlay: date,
            turn,
            blockedMotive: motive,
            player1: motive,
            isBlockedByAdmin: true,
          };
          newBookings.push(booking);
        });
      });
    });
    return await this.courtReserveService.adminReserve(newBookings, actor);
  }

  private async resolveMotive(
    requestedMotive: string,
    actor: BookingActor,
  ): Promise<string> {
    if (actor.role === 'admin') {
      return requestedMotive;
    }

    if (actor.role !== 'profesor') {
      throw new ForbiddenException('Solo administradores y profesores pueden crear reservas múltiples');
    }

    const professor = await this.registerService.findOneByEmail(actor.email.toLowerCase());
    const professorName = professor?.namePlayer?.trim();
    if (!professorName) {
      throw new NotFoundException('No se encontró el nombre asociado a la cuenta del profesor');
    }

    return `Clases - ${professorName}`;
  }
}
