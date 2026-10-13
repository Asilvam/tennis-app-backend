export interface CourtReserveResponse {
  statusCode: number;
  message: string;
}

export interface Slot {
  available: boolean;
  court: string;
  isPayed?: boolean;
  isBlockedByAdmin?: boolean;
  isPendingPayment?: boolean;
  holdExpiresAt?: string;
  data?: any;
}

export interface TimeSlot {
  time: string;
  slots: Slot[];
}
