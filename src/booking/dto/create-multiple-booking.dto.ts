export class CreateMultipleBookingDto {
  courts: string[]; // Array de canchas
  dates: string[]; // Array de fechas (en formato ISO u otro)
  turns: string[]; // Array de turnos (ej: "14:15-16:00")
  motive: string; // Motivo que se asignará también a player1
}
