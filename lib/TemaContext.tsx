import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NombreTema, Tema, TEMAS } from './tema';

const CLAVE_TEMA = '@tema_app';

interface ValorTemaContext {
  tema: Tema;
  nombreTema: NombreTema;
  alternarTema: () => void;
}

const TemaContext = createContext<ValorTemaContext | null>(null);

// Navy es el tema por defecto (nuevo); "oscuro" es el negro puro que había antes, disponible como
// alternativa desde el botón de la barra inferior. Se recuerda entre aperturas de la app.
export function TemaProvider({ children }: { children: React.ReactNode }) {
  const [nombreTema, setNombreTema] = useState<NombreTema>('navy');

  useEffect(() => {
    AsyncStorage.getItem(CLAVE_TEMA)
      .then(guardado => {
        if (guardado === 'navy' || guardado === 'oscuro') setNombreTema(guardado);
      })
      .catch(error => console.error('Error al cargar el tema guardado:', error));
  }, []);

  const alternarTema = () => {
    setNombreTema(prev => {
      const siguiente: NombreTema = prev === 'navy' ? 'oscuro' : 'navy';
      AsyncStorage.setItem(CLAVE_TEMA, siguiente).catch(error =>
        console.error('Error al guardar el tema elegido:', error)
      );
      return siguiente;
    });
  };

  const valor = useMemo<ValorTemaContext>(
    () => ({ tema: TEMAS[nombreTema], nombreTema, alternarTema }),
    [nombreTema]
  );

  return <TemaContext.Provider value={valor}>{children}</TemaContext.Provider>;
}

export function useTema(): ValorTemaContext {
  const contexto = useContext(TemaContext);
  if (!contexto) {
    throw new Error('useTema() debe usarse dentro de un <TemaProvider>.');
  }
  return contexto;
}
