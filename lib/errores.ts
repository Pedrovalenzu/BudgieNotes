// error instanceof Error falla para algunos errores de Supabase (PostgrestError/AuthError
// llegan como objetos planos en ciertos casos), así que miramos también .message a mano
// en vez de caer siempre al mensaje genérico.
export const mensajeDeError = (error: unknown, mensajePorDefecto: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const mensaje = (error as { message: unknown }).message;
    if (typeof mensaje === 'string' && mensaje) return mensaje;
  }
  return mensajePorDefecto;
};
