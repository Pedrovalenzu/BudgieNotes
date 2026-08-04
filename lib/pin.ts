import * as Crypto from 'expo-crypto';

// Crockford base32: 32 símbolos (0-9 y A-Z sin I, L, O, U, ambiguos con 1/1/0/V). 256 % 32 === 0,
// así que tomar cada byte aleatorio módulo 32 no introduce sesgo en el símbolo elegido.
const ALFABETO_PIN = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// PIN de unión a una nota compartida. También es la base de la clave de cifrado (ver lib/cifrado.ts),
// por eso son 16 símbolos (~80 bits) en vez de algo corto y fácil de teclear: se comparte con el
// botón de copiar, no escribiéndolo a mano, así que la longitud no cuesta nada en usabilidad.
export const generarPin = async (): Promise<string> => {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const simbolos = Array.from(bytes, b => ALFABETO_PIN[b % 32]);
  const bloques: string[] = [];
  for (let i = 0; i < simbolos.length; i += 4) {
    bloques.push(simbolos.slice(i, i + 4).join(''));
  }
  return bloques.join('-');
};
