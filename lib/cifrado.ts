import * as Crypto from 'expo-crypto';
import { decode as base64ABytesArrayBuffer, encode as bytesABase64Texto } from 'base64-arraybuffer';
import nacl from 'tweetnacl';

// tweetnacl no trae generador de números aleatorios propio (a propósito, para no arriesgarse a mala
// aleatoriedad en una plataforma que no reconoce). Se lo damos usando expo-crypto, que sí lo es.
nacl.setPRNG((buffer, cantidad) => {
  const aleatorios = Crypto.getRandomBytes(cantidad);
  for (let i = 0; i < cantidad; i++) buffer[i] = aleatorios[i];
});

// --- utf8 <-> bytes manual: Hermes solo soporta TextEncoder, no TextDecoder, así que no nos fiamos de ninguno ---
const utf8Codificar = (texto: string): Uint8Array => {
  const bytes: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.codePointAt(i)!;
    if (codigo > 0xffff) i++; // par sustituto: codePointAt ya lo combinó, saltamos la segunda mitad
    if (codigo < 0x80) {
      bytes.push(codigo);
    } else if (codigo < 0x800) {
      bytes.push(0xc0 | (codigo >> 6), 0x80 | (codigo & 0x3f));
    } else if (codigo < 0x10000) {
      bytes.push(0xe0 | (codigo >> 12), 0x80 | ((codigo >> 6) & 0x3f), 0x80 | (codigo & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codigo >> 18),
        0x80 | ((codigo >> 12) & 0x3f),
        0x80 | ((codigo >> 6) & 0x3f),
        0x80 | (codigo & 0x3f)
      );
    }
  }
  return new Uint8Array(bytes);
};

const utf8Decodificar = (bytes: Uint8Array): string => {
  let resultado = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let codigo: number;
    let extra: number;
    if (b0 < 0x80) { codigo = b0; extra = 0; }
    else if ((b0 & 0xe0) === 0xc0) { codigo = b0 & 0x1f; extra = 1; }
    else if ((b0 & 0xf0) === 0xe0) { codigo = b0 & 0x0f; extra = 2; }
    else { codigo = b0 & 0x07; extra = 3; }
    for (let j = 1; j <= extra; j++) codigo = (codigo << 6) | (bytes[i + j] & 0x3f);
    resultado += String.fromCodePoint(codigo);
    i += extra + 1;
  }
  return resultado;
};

const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const resultado = new Uint8Array(a.length + b.length);
  resultado.set(a, 0);
  resultado.set(b, a.length);
  return resultado;
};

const bytesABase64 = (bytes: Uint8Array): string =>
  bytesABase64Texto(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

const base64ABytes = (base64: string): Uint8Array => new Uint8Array(base64ABytesArrayBuffer(base64));

// Iteraciones del hash para la derivación de clave. Es una KDF simplificada (hash iterado con sal,
// no PBKDF2/Argon2 "de libro") para no depender de librerías de cifrado poco probadas fuera de Expo
// Go: tweetnacl solo da hash SHA-512 puro, así que construimos el coste iterándolo nosotros. El número
// es un compromiso rendimiento/seguridad sin poder medir en un dispositivo real — bajarlo si se nota
// lento al abrir una nota compartida, subirlo si hay margen.
const ITERACIONES_KDF = 20_000;

// Cada cuántas vueltas del hash se le cede el control al hilo de JS un instante (setTimeout 0),
// para que la interfaz no se quede congelada mientras se calculan las 20.000 iteraciones.
const LOTE_KDF = 500;

// Deriva la clave simétrica (32 bytes) de una nota compartida a partir de su PIN. `sal` es el
// `salCifrado` de la nota (aleatorio, generado una vez al crearla, no es secreto). Todo el que conoce
// el PIN puede repetir este cálculo localmente sin que Supabase intervenga en ningún momento.
export const derivarClaveDesdePin = async (pin: string, salBase64: string): Promise<Uint8Array> => {
  const sal = base64ABytes(salBase64);
  let hash = nacl.hash(concatBytes(utf8Codificar(pin), sal));
  for (let i = 1; i < ITERACIONES_KDF; i++) {
    hash = nacl.hash(concatBytes(hash, sal));
    if (i % LOTE_KDF === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return hash.slice(0, nacl.secretbox.keyLength);
};

export const generarSalBase64 = async (): Promise<string> => {
  const sal = await Crypto.getRandomBytesAsync(16);
  return bytesABase64(sal);
};

// Cifra bytes (p.ej. una imagen) con la clave derivada del PIN. Devuelve [nonce | texto cifrado]
// listo para guardarse/subirse tal cual: el nonce no es secreto, hace falta para descifrar.
export const cifrarBytes = (clave: Uint8Array, datos: Uint8Array): Uint8Array => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const cifrado = nacl.secretbox(datos, nonce, clave);
  return concatBytes(nonce, cifrado);
};

export const descifrarBytes = (clave: Uint8Array, empaquetado: Uint8Array): Uint8Array => {
  const nonce = empaquetado.slice(0, nacl.secretbox.nonceLength);
  const cifrado = empaquetado.slice(nacl.secretbox.nonceLength);
  const resultado = nacl.secretbox.open(cifrado, nonce, clave);
  if (!resultado) {
    throw new Error('No se ha podido descifrar: PIN incorrecto o datos dañados.');
  }
  return resultado;
};

// Igual que cifrarBytes/descifrarBytes pero para texto (el HTML de la nota), devolviendo/aceptando
// una única cadena base64 lista para guardar en una columna de texto.
export const cifrarTexto = (clave: Uint8Array, texto: string): string =>
  bytesABase64(cifrarBytes(clave, utf8Codificar(texto)));

export const descifrarTexto = (clave: Uint8Array, cifradoBase64: string): string =>
  utf8Decodificar(descifrarBytes(clave, base64ABytes(cifradoBase64)));
