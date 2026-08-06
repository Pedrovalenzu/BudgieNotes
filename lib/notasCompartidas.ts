import * as Crypto from 'expo-crypto';
import { asegurarSesionAnonima } from './auth';
import { cifrarContenidoNota, descifrarContenidoNota } from './contenidoCompartido';
import { cifrarTexto, derivarClaveDesdePin, descifrarTexto } from './cifrado';
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

// Alguien más guardó cambios en la nota entre que la abriste y que intentaste guardar tú.
export class ConflictoEdicionError extends Error {
  editadoPor: string | null;
  editadoEn: string | null;
  constructor(editadoPor: string | null, editadoEn: string | null) {
    super('Alguien ha editado esta nota mientras la tenías abierta.');
    this.name = 'ConflictoEdicionError';
    this.editadoPor = editadoPor;
    this.editadoEn = editadoEn;
  }
}

// editado_por es un auth.uid(); su nombre_usuario para ESTA nota vive en participantes_nota
// (no hay una relación declarada entre las dos tablas por esa columna, así que es una consulta aparte).
const resolverNombreEditor = async (
  cliente: NonNullable<typeof supabase>,
  notaId: string,
  usuarioId: string | null
): Promise<string | null> => {
  if (!usuarioId) return null;
  const { data } = await cliente
    .from('participantes_nota')
    .select('nombre_usuario')
    .eq('nota_id', notaId)
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  return data?.nombre_usuario ?? null;
};

// Crea una nota compartida nueva en Supabase: el creador queda registrado también como participante
// (con permiso de escritura), para que "editado_por" se pueda resolver siempre igual sin importar
// si el último en tocar la nota fue el creador o alguien que se unió después.
export const crearNotaCompartida = async (datos: {
  pin: string;
  salCifrado: string;
  titulo: string;
  contenidoHtml: string;
  nombreCreador: string;
  expiraEn?: number;
}): Promise<string> => {
  const cliente = requerirSupabase();
  const usuarioId = await asegurarSesionAnonima();
  const clave = await derivarClaveDesdePin(datos.pin, datos.salCifrado);
  const tituloCifrado = cifrarTexto(clave, datos.titulo);
  const contenidoCifrado = await cifrarContenidoNota(datos.contenidoHtml, clave);

  const { data: nota, error: errorNota } = await cliente
    .from('notas_compartidas')
    .insert({
      creador_id: usuarioId,
      pin_hash: await hashPin(datos.pin),
      sal_cifrado: datos.salCifrado,
      titulo_cifrado: tituloCifrado,
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
): Promise<{ notaId: string; salCifrado: string; clave: Uint8Array }> => {
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

  return {
    notaId: encontrada.id as string,
    salCifrado: encontrada.sal_cifrado as string,
    clave: await derivarClaveDesdePin(pin, encontrada.sal_cifrado as string),
  };
};

// Descarga y descifra el contenido actual de una nota compartida (por su id de Supabase, no el
// id local de AsyncStorage).
export const cargarNotaCompartida = async (
  notaId: string,
  clave: Uint8Array
): Promise<{ titulo: string; contenidoHtml: string; editadoPorUid: string | null; editadoEn: string | null }> => {
  const cliente = requerirSupabase();
  const { data: nota, error } = await cliente
    .from('notas_compartidas')
    .select('titulo_cifrado, contenido_cifrado, editado_por, editado_en')
    .eq('id', notaId)
    .single();

  if (error) throw error;

  const titulo = descifrarTexto(clave, nota.titulo_cifrado as string);
  const contenidoHtml = await descifrarContenidoNota(nota.contenido_cifrado as string, clave);

  // No se resuelve el nombre de quien editó aquí (sería otra consulta a Supabase en cada apertura
  // de nota): nada en la interfaz lo muestra todavía. Si en el futuro hace falta, resolverNombreEditor
  // sigue disponible para cuando exista esa pantalla, en vez de pagar el coste en cada apertura.
  return { titulo, contenidoHtml, editadoPorUid: nota.editado_por as string | null, editadoEn: nota.editado_en as string | null };
};

// Sube (sobrescribe) el título y el contenido cifrados, y anota quién hizo el cambio y cuándo.
export const guardarNotaCompartida = async (datos: {
  notaId: string;
  titulo: string;
  contenidoHtml: string;
  clave: Uint8Array;
  // editado_en que se vio al abrir la nota (null si nunca se había editado). Si al guardar el
  // valor actual en Supabase ya no coincide, alguien más guardó entre medias: no se sobrescribe
  // en silencio, se lanza ConflictoEdicionError para que quien llama decida qué hacer.
  ultimaEdicionConocida?: string | null;
  // Ignora la comprobación anterior y sobrescribe de todas formas (elegido por el usuario tras un conflicto).
  forzar?: boolean;
}): Promise<void> => {
  const cliente = requerirSupabase();
  const usuarioId = await asegurarSesionAnonima();
  const tituloCifrado = cifrarTexto(datos.clave, datos.titulo);
  const contenidoCifrado = await cifrarContenidoNota(datos.contenidoHtml, datos.clave);

  let consulta = cliente
    .from('notas_compartidas')
    .update({
      titulo_cifrado: tituloCifrado,
      contenido_cifrado: contenidoCifrado,
      editado_por: usuarioId,
      editado_en: new Date().toISOString(),
    })
    .eq('id', datos.notaId);

  if (!datos.forzar) {
    consulta = datos.ultimaEdicionConocida
      ? consulta.eq('editado_en', datos.ultimaEdicionConocida)
      : consulta.is('editado_en', null);
  }

  // Si RLS bloquea la escritura, o si la condición de arriba no encaja (alguien guardó entre
  // medias), Supabase no lanza un error: simplemente no actualiza ninguna fila. Por eso pedimos de
  // vuelta el id actualizado y comprobamos que de verdad haya una fila, en vez de asumir éxito.
  const { data, error } = await consulta.select('id');
  if (error) throw error;
  if (data && data.length > 0) return;

  // 0 filas: miramos el estado actual para saber si fue un conflicto (alguien guardó antes que
  // nosotros) o falta de permiso de escritura.
  const { data: actual } = await cliente
    .from('notas_compartidas')
    .select('editado_por, editado_en')
    .eq('id', datos.notaId)
    .maybeSingle();

  const huboConflicto = !datos.forzar && !!actual && actual.editado_en !== (datos.ultimaEdicionConocida ?? null);
  if (huboConflicto) {
    const nombreEditor = await resolverNombreEditor(cliente, datos.notaId, actual!.editado_por as string | null);
    throw new ConflictoEdicionError(nombreEditor, actual!.editado_en as string | null);
  }

  throw new Error('No tienes permiso de escritura en esta nota.');
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

// Un participante (no el creador) deja de estar en la nota: borra su propia fila. RLS ya permite
// que cada uno borre la suya (usuario_id = auth.uid()), así que no hace falta saber el id de la fila.
export const salirDeNotaCompartida = async (notaId: string): Promise<void> => {
  const cliente = requerirSupabase();
  const usuarioId = await asegurarSesionAnonima();
  const { error } = await cliente
    .from('participantes_nota')
    .delete()
    .eq('nota_id', notaId)
    .eq('usuario_id', usuarioId);
  if (error) throw error;
};

// El creador deja de compartir del todo: borra la nota de Supabase (participantes_nota se borra
// en cascada), acabando la sincronización para todos los que estuvieran dentro.
export const borrarNotaCompartidaDelServidor = async (notaId: string): Promise<void> => {
  const cliente = requerirSupabase();
  const { error } = await cliente.from('notas_compartidas').delete().eq('id', notaId);
  if (error) throw error;
};
