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
 *
 * Aún no está conectada a ningún guardado real (no existe todavía el envío de notas a Supabase),
 * pero queda lista para cuando exista.
 */
export const cifrarContenidoNota = async (html: string, clave: Uint8Array): Promise<string> => {
  let htmlConUrls = html;

  for (const [etiquetaCompleta, , base64] of html.matchAll(REGEX_IMG_BASE64)) {
    const bytesImagen = new Uint8Array(base64ABytesArrayBuffer(base64));
    const url = await subirBytesCompartidos(cifrarBytes(clave, bytesImagen));
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
  let resultado = html;

  for (const [etiquetaCompleta, url] of html.matchAll(REGEX_IMG_URL)) {
    if (!esImagenDelBucketCompartido(url)) continue;

    const bytesCifrados = await descargarBytesCompartidos(url);
    const bytesImagen = descifrarBytes(clave, bytesCifrados);
    const base64 = bytesABase64Texto(
      bytesImagen.buffer.slice(bytesImagen.byteOffset, bytesImagen.byteOffset + bytesImagen.byteLength) as ArrayBuffer
    );
    resultado = resultado.replace(etiquetaCompleta, reemplazarSrc(etiquetaCompleta, `data:image/jpeg;base64,${base64}`));
  }

  return resultado;
};
