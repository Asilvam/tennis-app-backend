export interface Booking {
  court: string;
  dateToPlay: string;
  turn: string;
  blockedMotive: string;
  player1: string; // Se asigna igual a motive
  isBlockedByAdmin: boolean;
}