import { decode as base64ABytesArrayBuffer, encode as bytesABase64Texto } from 'base64-arraybuffer';
import { cifrarBytes, cifrarTexto, descifrarBytes, descifrarTexto } from './cifrado';
import {
  descargarBytesCompartidos,
  esImagenDelBucketCompartido,
  subirBytesCompartidos,
} from './storageImagenes';

const REGEX_IMG_BASE64 = /<img[^>]+src="data:([^;]+);base64,([^"]+)"[^>]*>/g;
const REGEX_IMG_URL = /<img[^>]+src="(https:\/\/[^"]+)"[^>]*>/g;

const reemplazarSrc = (etiqueta: string, nuevoSrc: string) => etiqueta.replace(/src="[^"]+"/, `src="${nuevoSrc}"`);

/**
 * Prepara el HTML de una nota compartida para enviarlo a Supabase: cada imagen embebida en base64
 * se cifra y se sube a Storage (dejando solo su URL en el HTML), y por último se cifra el HTML
 * entero (título, texto y esas URLs) como un único bloque. Nada de esto llega a Supabase en claro.
 */
export const cifrarContenidoNota = async (html: string, clave: Uint8Array): Promise<string> => {
  const coincidencias = [...html.matchAll(REGEX_IMG_BASE64)];

  // Las imágenes se cifran y suben todas a la vez (no una detrás de otra) — con varias fotos en
  // la nota, esto es la diferencia entre esperar la suma de todas las subidas o solo la más lenta.
  const reemplazos = await Promise.all(
    coincidencias.map(async ([etiquetaCompleta, , base64]) => {
      const bytesImagen = new Uint8Array(base64ABytesArrayBuffer(base64));
      const url = await subirBytesCompartidos(cifrarBytes(clave, bytesImagen));
      return { etiquetaCompleta, url };
    })
  );

  let htmlConUrls = html;
  for (const { etiquetaCompleta, url } of reemplazos) {
    htmlConUrls = htmlConUrls.replace(etiquetaCompleta, reemplazarSrc(etiquetaCompleta, url));
  }

  return cifrarTexto(clave, htmlConUrls);
};

/**
 * Inversa de cifrarContenidoNota: descifra el HTML recibido de Supabase y, por cada imagen que
 * apunte a nuestro bucket, la descarga, la descifra y la deja como data URI para mostrarla.
 */
export const descifrarContenidoNota = async (cifrado: string, clave: Uint8Array): Promise<string> => {
  const html = descifrarTexto(clave, cifrado);
  const coincidencias = [...html.matchAll(REGEX_IMG_URL)].filter(([, url]) => esImagenDelBucketCompartido(url));

  // Igual que al cifrar: todas las imágenes se descargan y descifran a la vez, no una por una.
  const reemplazos = await Promise.all(
    coincidencias.map(async ([etiquetaCompleta, url]) => {
      const bytesCifrados = await descargarBytesCompartidos(url);
      const bytesImagen = descifrarBytes(clave, bytesCifrados);
      const base64 = bytesABase64Texto(
        bytesImagen.buffer.slice(bytesImagen.byteOffset, bytesImagen.byteOffset + bytesImagen.byteLength) as ArrayBuffer
      );
      return { etiquetaCompleta, dataUri: `data:image/jpeg;base64,${base64}` };
    })
  );

  let resultado = html;
  for (const { etiquetaCompleta, dataUri } of reemplazos) {
    resultado = resultado.replace(etiquetaCompleta, reemplazarSrc(etiquetaCompleta, dataUri));
  }

  return resultado;
};
