export interface Nota {
  id: string;
  titulo: string;
  contenido: string; // HTML enriquecido (negrita, cursiva, tachado, código, tareas, imágenes)
  esCompartida: boolean;
  pinAcceso?: string;
  salCifrado?: string; // aleatorio, generado junto al PIN; base de la clave de cifrado (ver lib/cifrado.ts)
  notaCompartidaId?: string; // id real en Supabase (distinto de `id`, que es el local de AsyncStorage)
  esCreador?: boolean; // true si la creaste tú; false si te uniste con el PIN de otra persona
  fecha: string;
  expiraEn?: number; // timestamp (ms); pasado ese momento la nota se autodestruye
}
