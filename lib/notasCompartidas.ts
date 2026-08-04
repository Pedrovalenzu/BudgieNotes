import * as Crypto from 'expo-crypto';
import { asegurarSesionAnonima } from './auth';
import { cifrarContenidoNota, descifrarContenidoNota } from './contenidoCompartido';
import { derivarClaveDesdePin } from './cifrado';
import { supabase } from './supabase';

const requerirSupabase = () => {
  if (!supabase) {
    throw new Error('Supabase no está configurado: copia .env.example a .env y añade tus credenciales.');
  }
  return supabase;
};

// Hash de solo-lectura para poder buscar la nota por PIN sin guardar el PIN en sí. No tiene relación
// con derivarClaveDesdePin() (esa es la que produce la clave de cifrado) — son dos derivaciones
// distintas del mismo PIN a propósito, así ni con acceso total a la BBDD se puede reconstruir la clave.
const hashPin = (pin: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);

export interface Participante {
  id: string;
  nombreUsuario: string;
  puedeEscribir: boolean;
  esCreador: boolean;
  unidoEn: string;
}

// Crea una nota compartida nueva en Supabase: el creador queda registrado también como participante
// (con permiso de escritura), para que "editado_por" se pueda resolver siempre igual sin importar
// si el último en tocar la nota fue el creador o alguien que se unió después.
export const crearNotaCompartida = async (datos: {
  pin: string;
  salCifrado: string;
  contenidoHtml: string;
  nombreCreador: string;
  expiraEn?: number;
}): Promise<string> => {
  const cliente = requerirSupabase();
  const usuarioId = await asegurarSesionAnonima();
  const clave = derivarClaveDesdePin(datos.pin, datos.salCifrado);
  const contenidoCifrado = await cifrarContenidoNota(datos.contenidoHtml, clave);

  const { data: nota, error: errorNota } = await cliente
    .from('notas_compartidas')
    .insert({
      creador_id: usuarioId,
      pin_hash: await hashPin(datos.pin),
      sal_cifrado: datos.salCifrado,
      contenido_cifrado: contenidoCifrado,
      expira_en: datos.expiraEn ? new Date(datos.expiraEn).toISOString() : null,
    })
    .select('id')
    .single();

  if (errorNota) throw errorNota;

  const { error: errorParticipante } = await cliente.from('participantes_nota').insert({
    nota_id: nota.id,
    usuario_id: usuarioId,
    nombre_usuario: datos.nombreCreador,
    puede_escribir: true,
  });

  if (errorParticipante) throw errorParticipante;

  return nota.id as string;
};

// Se une a una nota existente a partir de su PIN. Devuelve lo necesario para poder abrirla ya
// mismo (id + la clave, ya derivada) — quien llama decide cuándo descargar y descifrar el contenido.
export const unirseANotaPorPin = async (
  pin: string,
  nombreUsuario: string
): Promise<{ notaId: string; clave: Uint8Array }> => {
  const cliente = requerirSupabase();
  const usuarioId = await asegurarSesionAnonima();

  const { data, error } = await cliente.rpc('buscar_nota_por_pin', { p_pin_hash: await hashPin(pin) });
  if (error) throw error;
  const encontrada = data?.[0];
  if (!encontrada) throw new Error('No existe ninguna nota con ese PIN.');

  // Si ya eras participante (te vuelves a unir tras perder el PIN, p.ej.), no tocamos tu fila:
  // un upsert aquí resetearía silenciosamente puede_escribir a false si el creador ya te lo había dado.
  const { data: yaUnido } = await cliente
    .from('participantes_nota')
    .select('id')
    .eq('nota_id', encontrada.id)
    .eq('usuario_id', usuarioId)
    .maybeSingle();

  if (!yaUnido) {
    const { error: errorParticipante } = await cliente.from('participantes_nota').insert({
      nota_id: encontrada.id,
      usuario_id: usuarioId,
      nombre_usuario: nombreUsuario,
      puede_escribir: false,
    });
    if (errorParticipante) throw errorParticipante;
  }

  return { notaId: encontrada.id as string, clave: derivarClaveDesdePin(pin, encontrada.sal_cifrado as string) };
};

// Descarga y descifra el contenido actual de una nota compartida (por su id de Supabase, no el
// id local de AsyncStorage).
export const cargarNotaCompartida = async (
  notaId: string,
  clave: Uint8Array
): Promise<{ contenidoHtml: string; editadoPor: string | null; editadoEn: string | null }> => {
  const cliente = requerirSupabase();
  const { data: nota, error } = await cliente
    .from('notas_compartidas')
    .select('contenido_cifrado, editado_por, editado_en')
    .eq('id', notaId)
    .single();

  if (error) throw error;

  const contenidoHtml = await descifrarContenidoNota(nota.contenido_cifrado as string, clave);

  // editado_por es un auth.uid(); su nombre_usuario para ESTA nota vive en participantes_nota
  // (no hay una relación declarada entre las dos tablas por esa columna, así que es una consulta aparte).
  let nombreEditor: string | null = null;
  if (nota.editado_por) {
    const { data: participante } = await cliente
      .from('participantes_nota')
      .select('nombre_usuario')
      .eq('nota_id', notaId)
      .eq('usuario_id', nota.editado_por)
      .maybeSingle();
    nombreEditor = participante?.nombre_usuario ?? null;
  }

  return { contenidoHtml, editadoPor: nombreEditor, editadoEn: nota.editado_en as string | null };
};

// Sube (sobrescribe) el contenido cifrado y anota quién hizo el cambio y cuándo.
export const guardarNotaCompartida = async (datos: {
  notaId: string;
  contenidoHtml: string;
  clave: Uint8Array;
}): Promise<void> => {
  const cliente = requerirSupabase();
  const usuarioId = await asegurarSesionAnonima();
  const contenidoCifrado = await cifrarContenidoNota(datos.contenidoHtml, datos.clave);

  const { error } = await cliente
    .from('notas_compartidas')
    .update({
      contenido_cifrado: contenidoCifrado,
      editado_por: usuarioId,
      editado_en: new Date().toISOString(),
    })
    .eq('id', datos.notaId);

  if (error) throw error;
};

export const listarParticipantes = async (notaId: string): Promise<Participante[]> => {
  const cliente = requerirSupabase();

  const { data: nota, error: errorNota } = await cliente
    .from('notas_compartidas')
    .select('creador_id')
    .eq('id', notaId)
    .single();
  if (errorNota) throw errorNota;

  const { data, error } = await cliente
    .from('participantes_nota')
    .select('id, usuario_id, nombre_usuario, puede_escribir, unido_en')
    .eq('nota_id', notaId)
    .order('unido_en', { ascending: true });
  if (error) throw error;

  return (data ?? []).map(p => ({
    id: p.id as string,
    nombreUsuario: p.nombre_usuario as string,
    puedeEscribir: p.puede_escribir as boolean,
    esCreador: p.usuario_id === nota.creador_id,
    unidoEn: p.unido_en as string,
  }));
};

// Ambas requieren ser el creador de la nota — lo aplica RLS, no esta función; si quien llama no es
// el creador, Supabase devuelve 0 filas afectadas en vez de un cambio real.
export const cambiarPermisoEscritura = async (participanteId: string, puedeEscribir: boolean): Promise<void> => {
  const cliente = requerirSupabase();
  const { error } = await cliente
    .from('participantes_nota')
    .update({ puede_escribir: puedeEscribir })
    .eq('id', participanteId);
  if (error) throw error;
};

export const revocarParticipante = async (participanteId: string): Promise<void> => {
  const cliente = requerirSupabase();
  const { error } = await cliente.from('participantes_nota').delete().eq('id', participanteId);
  if (error) throw error;
};
