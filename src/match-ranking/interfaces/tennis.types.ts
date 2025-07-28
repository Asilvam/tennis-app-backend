export enum PlayerCategory {
  PRIMERA = '1',
  SEGUNDA = '2',
  TERCERA = '3',
  CUARTA = '4',
  DAMAS = 'Damas',
  MENORES = 'Menores',
  MENORES_AMARILLA = 'Menores - Cancha Amarilla',
  MENORES_VERDE = 'Menores - Cancha Verde',
  MENORES_NARANJA = 'Menores - Cancha Naranja',
  MENORES_ROJA = 'Menores - Cancha Roja',
}

export interface Jugador {
  id: string; // Usaremos el email como ID único
  nombre: string; // namePlayer
  puntos: number; // points convertidos a number
  categoria: PlayerCategory; // category
  rank: number; // Posición en el ranking (calculado en el backend)
  cellular: string;
}

// Define la estructura de un resultado de partido
export interface Resultado {
  id: string; // matchId / idCourtReserve
  jugadorId: string; // email del jugador
  fecha: string; // dateToPlay de CourtReserve
  rival: string; // Nombre del rival (playerX de CourtReserve)
  score: string; // result de MatchRanking
  ganador: boolean; // true si el jugador ganó el partido
  torneo?: string; // Podrías añadir un campo para el nombre del torneo en CourtReserve si lo necesitas
}

// Opciones para el filtro de tiempo
export type PeriodoTiempo = 'semana' | 'mes' | 'todos';

// Tipos para los filtros
export interface FiltrosResultados {
  periodo: PeriodoTiempo;
}

export type RankingPorCategoria = Record<string, Jugador[]>;
