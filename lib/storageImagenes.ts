import { supabase } from './supabase';

const BUCKET_IMAGENES_COMPARTIDAS = 'notas-compartidas';

// Sube bytes YA CIFRADOS (ver lib/cifrado.ts) al bucket y devuelve su URL pública. Supabase
// almacena y sirve el archivo tal cual: no sabe que es una imagen ni puede leerla.
export const subirBytesCompartidos = async (bytes: Uint8Array): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase no está configurado: copia .env.example a .env y añade tus credenciales.');
  }

  const nombreArchivo = `${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;

  const { error } = await supabase.storage
    .from(BUCKET_IMAGENES_COMPARTIDAS)
    .upload(nombreArchivo, bytes, { contentType: 'application/octet-stream' });

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET_IMAGENES_COMPARTIDAS).getPublicUrl(nombreArchivo);
  return data.publicUrl;
};

// Descarga los bytes cifrados desde una URL pública del bucket, para descifrarlos después.
export const descargarBytesCompartidos = async (url: string): Promise<Uint8Array> => {
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${respuesta.status}).`);
  return new Uint8Array(await respuesta.arrayBuffer());
};

export const esImagenDelBucketCompartido = (url: string) =>
  url.includes(`/storage/v1/object/public/${BUCKET_IMAGENES_COMPARTIDAS}/`);
