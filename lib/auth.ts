import { supabase } from './supabase';

// La app no tiene login: cada instalación necesita igualmente un auth.uid() estable para que las
// políticas RLS de Supabase (quién es el creador, quién puede escribir) puedan aplicarse de verdad.
// signInAnonymously() es invisible para el usuario — no pide email ni contraseña — y la sesión
// queda guardada en AsyncStorage (ver lib/supabase.ts), así que solo ocurre una vez por instalación.
export const asegurarSesionAnonima = async (): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase no está configurado: copia .env.example a .env y añade tus credenciales.');
  }

  const { data: sesionActual } = await supabase.auth.getSession();
  if (sesionActual.session) return sesionActual.session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user!.id;
};
