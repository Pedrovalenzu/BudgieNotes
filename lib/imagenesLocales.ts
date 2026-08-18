import { Directory, File, Paths } from 'expo-file-system';

const NOMBRE_CARPETA = 'imagenes-notas';

// Directorio base (file://...) donde vive `imagenes-notas/`. El editor (WebView) necesita
// cargarse con esta URI como baseUrl para poder resolver los <img src="file://..."> que
// apuntan a esas imágenes: sin un origen file:// coincidente, el WebView las bloquea y solo
// se ve el icono de imagen rota.
export const uriCarpetaDocumentos = Paths.document.uri;

const carpetaImagenes = (): Directory => {
  const carpeta = new Directory(Paths.document, NOMBRE_CARPETA);
  if (!carpeta.exists) carpeta.create({ intermediates: true, idempotent: true });
  return carpeta;
};

// Guarda una imagen en base64 como archivo aparte en el disco del dispositivo y devuelve su
// URI local (file://...). Así el HTML de la nota nunca vuelve a llevar el base64 embebido.
const guardarImagenLocal = (base64: string, mime: string): string => {
  const extension = mime.split('/')[1]?.split('+')[0]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  const nombre = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const archivo = new File(carpetaImagenes(), nombre);
  archivo.create({ overwrite: true });
  archivo.write(base64, { encoding: 'base64' });
  return archivo.uri;
};

const REGEX_IMG_BASE64 = /<img[^>]+src="data:([^;]+);base64,([^"]+)"[^>]*>/g;
const REGEX_IMG_ARCHIVO_LOCAL = /<img[^>]+src="(file:\/\/[^"]+)"[^>]*>/g;
const reemplazarSrc = (etiqueta: string, nuevoSrc: string) => etiqueta.replace(/src="[^"]+"/, `src="${nuevoSrc}"`);

// Sustituye toda imagen embebida en base64 del HTML de una nota por un archivo local aparte,
// dejando solo su ruta (file://...) en el src. Se llama justo antes de guardar en AsyncStorage
// (nunca antes de subir a Supabase, que necesita el base64 original — ver cifrarContenidoNota).
export const moverImagenesEmbebidasAArchivos = (html: string): string => {
  let resultado = html;
  for (const [etiquetaCompleta, mime, base64] of [...html.matchAll(REGEX_IMG_BASE64)]) {
    const uri = guardarImagenLocal(base64, mime);
    resultado = resultado.replace(etiquetaCompleta, reemplazarSrc(etiquetaCompleta, uri));
  }
  return resultado;
};

// Borra del disco las imágenes locales referenciadas en el HTML de una nota (al borrarla), para
// no dejar archivos huérfanos ocupando espacio para siempre. Best-effort: un fallo aquí no debe
// impedir borrar la nota.
export const borrarImagenesLocalesDeNota = (html: string): void => {
  for (const [, uri] of html.matchAll(REGEX_IMG_ARCHIVO_LOCAL)) {
    try {
      const archivo = new File(uri);
      if (archivo.exists) archivo.delete();
    } catch (error) {
      console.error('Error al borrar una imagen local huérfana:', error);
    }
  }
};
