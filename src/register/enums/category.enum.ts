export enum Category {
  PRIMERA = '1',
  SEGUNDA = '2',
  TERCERA = '3',
  CUARTA = '4',
  DOBLES = 'Dobles',
  DAMAS = 'Damas',
  MAS_55 = '+55',
  MAS_65 = '+65',
  MENORES = 'Menores',
  MENORES_CANCHA_AMARILLA = 'Menores - Cancha Amarilla',
  MENORES_CANCHA_VERDE = 'Menores - Cancha Verde',
  MENORES_CANCHA_NARANJA = 'Menores - Cancha Naranja',
  MENORES_CANCHA_ROJA = 'Menores - Cancha Roja',
}

// Enum para tipos de partido
export enum MatchType {
  SINGLES = 'singles',
  DOUBLES = 'doubles',
}

// Categorías principales de singles (1-4). Un jugador solo puede tener una activa.
export const MAIN_SINGLES_CATEGORIES: string[] = [Category.PRIMERA, Category.SEGUNDA, Category.TERCERA, Category.CUARTA];

// Categoría única de dobles
export const DOUBLES_CATEGORY = Category.DOBLES;

// Categorías especiales de singles (todo lo que no sea 1-4 ni Dobles)
export const SPECIAL_SINGLES_CATEGORIES: string[] = Object.values(Category).filter((category) => !MAIN_SINGLES_CATEGORIES.includes(category) && category !== DOUBLES_CATEGORY);
