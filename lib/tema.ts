// Tokens de color reutilizados en toda la app. Los dos temas comparten exactamente la misma
// escala de "claridad" (fondo < superficie < borde < bordeFuerte < texto...), solo cambia el matiz:
// Navy tiñe cada escalón de azul marino (a partir de #0F172A); Oscuro es el negro puro original.
export interface Tema {
  fondo: string;
  superficie: string;
  borde: string;
  bordeFuerte: string;
  textoTerciario: string;
  textoSecundario: string;
  textoSecundarioAlt: string;
  textoIcono: string;
}

export type NombreTema = 'navy' | 'oscuro';

export const TEMA_NAVY: Tema = {
  fondo: '#0F172A',
  superficie: '#182033',
  borde: '#222A3D',
  bordeFuerte: '#333B4E',
  textoTerciario: '#444C5F',
  textoSecundario: '#555D70',
  textoSecundarioAlt: '#777F92',
  textoIcono: '#8890A3',
};

export const TEMA_OSCURO: Tema = {
  fondo: '#0f0f0f',
  superficie: '#181818',
  borde: '#222222',
  bordeFuerte: '#333333',
  textoTerciario: '#444444',
  textoSecundario: '#555555',
  textoSecundarioAlt: '#777777',
  textoIcono: '#888888',
};

export const TEMAS: Record<NombreTema, Tema> = {
  navy: TEMA_NAVY,
  oscuro: TEMA_OSCURO,
};
