import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEditorBridge, RichText, useBridgeState, BridgeExtension, TenTapStartKit, PlaceholderBridge } from '@10play/tentap-editor';
import { generarPin } from './lib/pin';
import { generarSalBase64, derivarClaveDesdePin } from './lib/cifrado';
import { asegurarSesionAnonima } from './lib/auth';
import { supabase } from './lib/supabase';
import {
  borrarNotaCompartidaDelServidor,
  cargarNotaCompartida,
  ConflictoEdicionError,
  crearNotaCompartida,
  guardarNotaCompartida,
  salirDeNotaCompartida,
  unirseANotaPorPin,
} from './lib/notasCompartidas';
import { mensajeDeError } from './lib/errores';
import { Nota } from './types';
import { Tema } from './lib/tema';
import { TemaProvider, useTema } from './lib/TemaContext';
import ModalUnirseNota from './components/ModalUnirseNota';
import ModalParticipantes from './components/ModalParticipantes';

const CLAVE_STORAGE = '@mis_notas_locales';

// Convierte el HTML de una nota a texto plano para la previsualización de la tarjeta
const textoPlano = (html: string) => {
  if (!html) return '';
  return html
    .replace(/<(p|li|br|div)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
};

// Una nota con solo una imagen y sin texto no debe tratarse como vacía
const contenidoVacio = (html: string) => !textoPlano(html) && !/<img\b/i.test(html);

const notaExpirada = (nota: Nota) => typeof nota.expiraEn === 'number' && nota.expiraEn <= Date.now();

const formatoFechaHora = (timestamp: number) =>
  `${new Date(timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}, ${new Date(timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;

// Se comprueban en el propio dispositivo (no hay backend), así que solo se aplica mientras la app está abierta
const OPCIONES_CADUCIDAD: { texto: string; horas: number }[] = [
  { texto: '1 hora', horas: 1 },
  { texto: '6 horas', horas: 6 },
  { texto: '24 horas', horas: 24 },
  { texto: '3 días', horas: 72 },
  { texto: '7 días', horas: 168 },
];

const crearCssEditor = (t: Tema) => `
  html, body { background-color: ${t.fondo}; margin: 0; }
  .ProseMirror {
    color: #ccc !important;
    font-size: 15px;
    line-height: 22px;
    padding: 0;
    caret-color: #ff6b00;
  }
  .ProseMirror, .ProseMirror p, .ProseMirror li, .ProseMirror div {
    color: #ccc !important;
  }
  .ProseMirror p { margin: 0 0 8px 0; }
  strong { color: #ff6b00 !important; }
  code {
    background-color: ${t.superficie};
    color: #00ff88 !important;
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 0.85em;
  }
  s { color: ${t.textoSecundarioAlt} !important; }
  img {
    border-radius: 10px;
    margin: 8px 0;
  }
  ul[data-type="taskList"] li > label > input {
    border: 1px solid ${t.textoSecundario} !important;
    background: ${t.superficie} !important;
    accent-color: #ff6b00;
  }
  .is-editor-empty:first-child::before { color: ${t.bordeFuerte}; }
`;

// Va en bridgeExtensions (no injectCSS) para que se aplique al cargar, sin el texto negro por defecto de por medio.
// Se crea dentro de ModalEditorNota (no aquí, a nivel de módulo) porque necesita el tema actual.
const crearBridgeTema = (t: Tema) =>
  new BridgeExtension({
    forceName: 'temaOscuro',
    extendCSS: crearCssEditor(t),
  });

// El checkbox de tarea de Tiptap hace focus() internamente al marcar/desmarcar y a veces
// la selección salta al final del documento. Guardamos el cursor justo antes del click
// y lo restauramos después, sin tocar el foco (el teclado se queda como estaba).
const JS_MANTENER_CURSOR_EN_TAREAS = `
  (function() {
    if (window.__mantenerCursorTarea) { return true; }
    window.__mantenerCursorTarea = true;
    var rangoPrevio = null;
    function esCheckboxTarea(el) {
      return !!(el && el.tagName === 'INPUT' && el.type === 'checkbox' && el.closest('ul[data-type="taskList"]'));
    }
    document.addEventListener('mousedown', function (e) {
      if (esCheckboxTarea(e.target)) {
        var sel = window.getSelection();
        rangoPrevio = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
      }
    }, true);
    document.addEventListener('change', function (e) {
      if (esCheckboxTarea(e.target) && rangoPrevio) {
        var rango = rangoPrevio;
        setTimeout(function () {
          var sel = window.getSelection();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(rango);
          }
        }, 0);
      }
    });
    true;
  })();
`;

type Filtro = 'todas' | 'compartidas' | 'locales' | 'autodestructivas';

// Alto de la barra inferior sin contar el margen de seguridad del sistema (que varía según el
// dispositivo y se suma aparte, vía useSafeAreaInsets): paddingTop + contenido + paddingBottom.
const ALTO_BASE_BARRA_INFERIOR = 57;

// SafeAreaProvider tiene que envolver a quien use useSafeAreaInsets(), no puede ser el mismo
// componente que lo declara — por eso el contenido real vive aparte, en PantallaPrincipal.
export default function App() {
  return (
    <TemaProvider>
      <SafeAreaProvider>
        <PantallaPrincipal />
      </SafeAreaProvider>
    </TemaProvider>
  );
}

function PantallaPrincipal() {
  const insets = useSafeAreaInsets();
  const { tema, nombreTema, alternarTema } = useTema();
  const styles = useMemo(() => crearEstilos(tema), [tema]);
  const [notas, setNotas] = useState<Nota[]>([]);
  const [cargando, setCargando] = useState(true);

  // Estados del Editor
  const [modalVisible, setModalVisible] = useState(false);
  const [notaSeleccionada, setNotaSeleccionada] = useState<Nota | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const [mostrarUnirse, setMostrarUnirse] = useState(false);
  const [cargandoNotaId, setCargandoNotaId] = useState<string | null>(null);
  const [mostrarConfirmarBorrado, setMostrarConfirmarBorrado] = useState(false);

  // Barra inferior: filtro de tipo de nota + búsqueda por título
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busquedaActiva, setBusquedaActiva] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const alternarFiltro = (nuevo: Filtro) => {
    setFiltro(prev => (prev === nuevo ? 'todas' : nuevo));
  };

  const alternarBusqueda = () => {
    setBusquedaActiva(prev => {
      if (prev) setBusqueda('');
      return !prev;
    });
  };

  const notasVisibles = notas.filter(n => {
    if (filtro === 'compartidas' && !n.esCompartida) return false;
    if (filtro === 'locales' && n.esCompartida) return false;
    if (filtro === 'autodestructivas' && n.expiraEn === undefined) return false;
    if (busqueda.trim() && !n.titulo.toLowerCase().includes(busqueda.trim().toLowerCase())) return false;
    return true;
  });

  // 1. CARGAR NOTAS DEL MÓVIL AL ABRIR LA APP
  useEffect(() => {
    cargarNotasGuardadas();
  }, []);

  // Sesión anónima de Supabase (si está configurado): la necesita RLS para saber quién es el
  // creador/participante de una nota compartida. No pide login, es transparente para el usuario.
  useEffect(() => {
    if (supabase) {
      asegurarSesionAnonima().catch(error => console.error('Error al iniciar sesión anónima:', error));
    }
  }, []);

  // Mientras la app está abierta, revisa cada minuto si alguna nota ha caducado y la borra
  useEffect(() => {
    const intervalo = setInterval(() => {
      setNotas(prev => {
        const vigentes = prev.filter(n => !notaExpirada(n));
        if (vigentes.length !== prev.length) {
          guardarEnStorage(vigentes);
          return vigentes;
        }
        return prev;
      });
    }, 60000);
    return () => clearInterval(intervalo);
  }, []);

  const cargarNotasGuardadas = async () => {
    try {
      const datosJson = await AsyncStorage.getItem(CLAVE_STORAGE);
      if (datosJson !== null) {
        const notasGuardadas: Nota[] = JSON.parse(datosJson);
        const vigentes = notasGuardadas.filter(n => !notaExpirada(n));
        setNotas(vigentes);
        if (vigentes.length !== notasGuardadas.length) {
          guardarEnStorage(vigentes);
        }
      }
    } catch (error) {
      console.error('Error al cargar notas del almacenamiento local:', error);
    } finally {
      setCargando(false);
    }
  };

  // 2. GUARDAR EL ARRAY DE NOTAS EN EL MÓVIL
  const guardarEnStorage = async (nuevasNotas: Nota[]) => {
    try {
      const datosJson = JSON.stringify(nuevasNotas);
      await AsyncStorage.setItem(CLAVE_STORAGE, datosJson);
    } catch (error) {
      console.error('Error al guardar notas en el almacenamiento local:', error);
    }
  };

  const abrirCreador = () => {
    setNotaSeleccionada(null);
    setEditorSession(s => s + 1);
    setModalVisible(true);
  };

  const abrirEditor = async (nota: Nota) => {
    // Notas locales: se abre tal cual, sin red de por medio.
    if (!nota.esCompartida || !nota.notaCompartidaId || !nota.pinAcceso || !nota.salCifrado) {
      setNotaSeleccionada(nota);
      setEditorSession(s => s + 1);
      setModalVisible(true);
      return;
    }

    // Notas compartidas: la copia local puede estar desactualizada si otro participante ha
    // editado desde entonces. Se pide primero la versión actual a Supabase y se descifra, en vez
    // de abrir directamente lo último que se guardó en este dispositivo.
    setCargandoNotaId(nota.id);
    let notaParaAbrir = nota;
    try {
      const clave = await derivarClaveDesdePin(nota.pinAcceso, nota.salCifrado);
      const { titulo, contenidoHtml, editadoEn } = await cargarNotaCompartida(nota.notaCompartidaId, clave);
      notaParaAbrir = { ...nota, titulo, contenido: contenidoHtml, ultimaEdicionConocida: editadoEn };

      const notasActualizadas = notas.map(n => (n.id === nota.id ? notaParaAbrir : n));
      setNotas(notasActualizadas);
      guardarEnStorage(notasActualizadas);
    } catch (error) {
      console.error('Error al refrescar la nota compartida:', error);
      Alert.alert(
        'Sin conexión con la nube',
        'No se ha podido comprobar si hay cambios nuevos. Se abre la última versión guardada en este dispositivo.'
      );
    } finally {
      setCargandoNotaId(null);
    }

    setNotaSeleccionada(notaParaAbrir);
    setEditorSession(s => s + 1);
    setModalVisible(true);
  };

  // 3. GUARDAR CAMBIOS (CREAR / EDITAR / ELIMINAR)
  const guardarNota = (datos: {
    titulo: string;
    contenido: string;
    esCompartida: boolean;
    expiraEn?: number;
    pinAcceso?: string;
    salCifrado?: string;
    notaCompartidaId?: string;
    esCreador?: boolean;
  }) => {
    const { titulo, contenido, esCompartida, expiraEn, pinAcceso, salCifrado, notaCompartidaId, esCreador } = datos;

    if (!titulo.trim() && contenidoVacio(contenido)) {
      setModalVisible(false);
      return;
    }

    let notasActualizadas: Nota[];

    if (notaSeleccionada) {
      notasActualizadas = notas.map(n => n.id === notaSeleccionada.id ? {
        ...n,
        titulo,
        contenido,
        esCompartida,
        pinAcceso: esCompartida ? pinAcceso : undefined,
        salCifrado: esCompartida ? salCifrado : undefined,
        notaCompartidaId: esCompartida ? notaCompartidaId : undefined,
        esCreador: esCompartida ? esCreador : undefined,
        expiraEn,
      } : n);
    } else {
      const nuevaNota: Nota = {
        id: Date.now().toString(),
        titulo: titulo || 'Sin título',
        contenido,
        esCompartida,
        pinAcceso: esCompartida ? pinAcceso : undefined,
        salCifrado: esCompartida ? salCifrado : undefined,
        notaCompartidaId: esCompartida ? notaCompartidaId : undefined,
        esCreador: esCompartida ? esCreador : undefined,
        fecha: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
        expiraEn,
      };
      notasActualizadas = [nuevaNota, ...notas];
    }

    setNotas(notasActualizadas);
    guardarEnStorage(notasActualizadas);
    setModalVisible(false);
  };

  // Se llama cuando ModalUnirseNota termina de unirse y descargar la nota: se añade a la lista local
  const notaUnida = (nota: Nota) => {
    const notasActualizadas = [nota, ...notas];
    setNotas(notasActualizadas);
    guardarEnStorage(notasActualizadas);
    setMostrarUnirse(false);
  };

  // 4. BORRAR UNA NOTA (confirmación con panel propio, igual que el resto de la app —
  // Alert.alert es del sistema operativo y no se puede pintar con los colores del tema)
  const borrarNota = () => {
    if (!notaSeleccionada) return;
    setMostrarConfirmarBorrado(true);
  };

  const confirmarBorrado = async () => {
    if (!notaSeleccionada) return;
    setMostrarConfirmarBorrado(false);

    if (notaSeleccionada.notaCompartidaId) {
      try {
        if (notaSeleccionada.esCreador) {
          await borrarNotaCompartidaDelServidor(notaSeleccionada.notaCompartidaId);
        } else {
          await salirDeNotaCompartida(notaSeleccionada.notaCompartidaId);
        }
      } catch (error) {
        console.error('Error al limpiar la nota compartida en Supabase:', error);
      }
    }

    const notasFiltradas = notas.filter(n => n.id !== notaSeleccionada.id);
    setNotas(notasFiltradas);
    guardarEnStorage(notasFiltradas);
    setModalVisible(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={tema.fondo} />

      {/* Cabecera */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {filtro === 'compartidas' ? 'Notas compartidas' : filtro === 'locales' ? 'Notas Locales' : 'Budgie Notes'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {cargando ? 'Cargando...' : `${notasVisibles.length} notas guardadas`}
          </Text>
        </View>
        <TouchableOpacity style={styles.botonUnirse} onPress={() => setMostrarUnirse(true)}>
          <Feather name="user-plus" size={20} color={tema.textoIcono} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.botonUnirse, styles.botonTema]} onPress={alternarTema}>
          <Feather
            name={nombreTema === 'oscuro' ? 'moon' : 'sun'}
            size={20}
            color={nombreTema === 'oscuro' ? '#ff6b00' : tema.textoIcono}
          />
        </TouchableOpacity>
      </View>

      {/* Búsqueda por título (se abre desde la lupa de la barra inferior) */}
      {busquedaActiva && (
        <View style={styles.busquedaFila}>
          <Feather name="search" size={16} color={tema.textoSecundarioAlt} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.busquedaInput}
            placeholder="Buscar por título..."
            placeholderTextColor={tema.textoTerciario}
            value={busqueda}
            onChangeText={setBusqueda}
            autoFocus
          />
          {busqueda.length > 0 && (
            <TouchableOpacity onPress={() => setBusqueda('')}>
              <Feather name="x" size={16} color={tema.textoSecundarioAlt} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Grid de Tarjetas */}
      <FlatList
        data={notasVisibles}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          !cargando ? (
            <View style={styles.emptyContainer}>
              <Feather name="file-text" size={40} color={tema.bordeFuerte} />
              <Text style={styles.emptyText}>
                {notas.length === 0 ? 'No tienes notas guardadas.' : 'Ninguna nota coincide con este filtro.'}
              </Text>
            </View>
          ) : null
        )}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => abrirEditor(item)}
            disabled={cargandoNotaId === item.id}
          >
            {cargandoNotaId === item.id && (
              <View style={styles.cardCargando}>
                <ActivityIndicator color="#ff6b00" />
              </View>
            )}

            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.titulo}
              </Text>
            </View>

            <Text style={styles.cardContent} numberOfLines={4}>
              {textoPlano(item.contenido) || 'Nota vacía...'}
            </Text>

            <View style={styles.cardFooter}>
              <Text style={styles.cardDate}>{item.fecha}</Text>

              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {item.expiraEn !== undefined && (
                  <Feather name="clock" size={11} color="#ff6b00" style={{ marginRight: 6 }} />
                )}
                <View style={[styles.badge, item.esCompartida ? styles.badgeCompartida : styles.badgeLocal]}>
                  <Feather
                    name={item.esCompartida ? "share-2" : "lock"}
                    size={10}
                    color={item.esCompartida ? "#ff6b00" : tema.textoIcono}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.badgeText, item.esCompartida && styles.badgeTextCompartida]}>
                    {item.esCompartida ? 'PIN' : 'Local'}
                  </Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Botón Flotante */}
      <TouchableOpacity
        style={[styles.fab, { bottom: ALTO_BASE_BARRA_INFERIOR + insets.bottom + 16 }]}
        activeOpacity={0.8}
        onPress={abrirCreador}
      >
        <Feather name="plus" size={26} color="#ffffff" />
      </TouchableOpacity>

      {/* Barra inferior: dos mitades de ancho EXACTAMENTE igual (flex:1 cada una), con los botones
          empujados hacia el centro dentro de cada mitad — así el borde entre ambas cae siempre en
          el 50% real de la barra, justo donde está la lupa (posición absoluta), sin importar cuántos
          botones haya a cada lado ni cuánto ocupen. El paddingBottom extra reserva el hueco real de
          los gestos/botones del sistema (SafeAreaView ya no lo hace, ver edges arriba). */}
      <View style={[styles.barraInferior, { paddingBottom: 12 + insets.bottom }]}>
        <View style={[styles.barraMitad, styles.barraMitadIzquierda]}>
          <TouchableOpacity style={styles.barraBoton} onPress={() => alternarFiltro('compartidas')}>
            <Feather name="share-2" size={20} color={filtro === 'compartidas' ? '#ff6b00' : tema.textoIcono} />
            <Text style={[styles.barraTexto, filtro === 'compartidas' && styles.barraTextoActivo]}>Compartidas</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.barraBoton} onPress={() => alternarFiltro('locales')}>
            <Feather name="lock" size={20} color={filtro === 'locales' ? '#ff6b00' : tema.textoIcono} />
            <Text style={[styles.barraTexto, filtro === 'locales' && styles.barraTextoActivo]}>Locales</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.barraMitad, styles.barraMitadDerecha]}>
          <TouchableOpacity style={styles.barraBoton} onPress={() => alternarFiltro('autodestructivas')}>
            <Feather name="clock" size={20} color={filtro === 'autodestructivas' ? '#ff6b00' : tema.textoIcono} />
            <Text style={[styles.barraTexto, filtro === 'autodestructivas' && styles.barraTextoActivo]}>Temporales</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.barraBotonCentro, busquedaActiva && styles.barraBotonCentroActivo]}
          onPress={alternarBusqueda}
        >
          <Feather name="search" size={22} color={busquedaActiva ? tema.fondo : '#fff'} />
        </TouchableOpacity>
      </View>

      {/* MODAL / EDITOR DE NOTAS */}
      <ModalEditorNota
        key={editorSession}
        visible={modalVisible}
        nota={notaSeleccionada}
        onClose={() => setModalVisible(false)}
        onSave={guardarNota}
        onDelete={borrarNota}
      />

      <ModalUnirseNota
        visible={mostrarUnirse}
        onClose={() => setMostrarUnirse(false)}
        onUnido={notaUnida}
        pinesUnidos={notas.filter(n => n.pinAcceso).map(n => n.pinAcceso as string)}
      />

      {/* Confirmación de borrado (Alert.alert es del sistema operativo y no se puede pintar
          con los colores del tema — mismo panel propio que el resto de la app) */}
      <Modal
        visible={mostrarConfirmarBorrado}
        transparent
        animationType="fade"
        onRequestClose={() => setMostrarConfirmarBorrado(false)}
      >
        <TouchableOpacity
          style={styles.opcionesFondo}
          activeOpacity={1}
          onPress={() => setMostrarConfirmarBorrado(false)}
        >
          <TouchableOpacity
            style={[styles.opcionesTarjeta, { paddingBottom: Math.max(20, insets.bottom + 12) }]}
            activeOpacity={1}
            onPress={() => {}}
          >
            <Text style={styles.opcionesTitulo}>Borrar nota</Text>
            <Text style={styles.opcionesSubtitulo}>
              ¿Seguro que quieres borrar esta nota? Esta acción no se puede deshacer.
            </Text>

            <TouchableOpacity style={styles.opcionFila} onPress={confirmarBorrado}>
              <Text style={[styles.opcionTexto, styles.opcionTextoQuitar]}>Borrar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.opcionFila} onPress={() => setMostrarConfirmarBorrado(false)}>
              <Text style={[styles.opcionTexto, styles.opcionTextoCancelar]}>Cancelar</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function ModalEditorNota({
  visible,
  nota,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  nota: Nota | null;
  onClose: () => void;
  onSave: (datos: {
    titulo: string;
    contenido: string;
    esCompartida: boolean;
    expiraEn?: number;
    pinAcceso?: string;
    salCifrado?: string;
    notaCompartidaId?: string;
    esCreador?: boolean;
  }) => void;
  onDelete: () => void;
}) {
  const { tema } = useTema();
  const styles = useMemo(() => crearEstilos(tema), [tema]);
  const [tituloInput, setTituloInput] = useState(nota?.titulo ?? '');
  const [esCompartidaInput, setEsCompartidaInput] = useState(nota?.esCompartida ?? false);
  const [pinInput, setPinInput] = useState(nota?.pinAcceso);
  const [salInput, setSalInput] = useState(nota?.salCifrado);
  const [nombreCreadorInput, setNombreCreadorInput] = useState('');
  const [pinCopiado, setPinCopiado] = useState(false);
  const [expiraEnInput, setExpiraEnInput] = useState<number | undefined>(nota?.expiraEn);
  const [mostrarOpcionesCaducidad, setMostrarOpcionesCaducidad] = useState(false);
  const [mostrarParticipantes, setMostrarParticipantes] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [conflicto, setConflicto] = useState<ConflictoEdicionError | null>(null);
  const insets = useSafeAreaInsets();

  // En Android, adjustPan ya desplaza algo la ventana al mostrarse el teclado (aunque el foco
  // esté dentro del WebView del editor, no en un EditText nativo), pero no lo suficiente para
  // dejar la barra de herramientas visible. En vez de sumar la altura completa del teclado (que
  // se solapa con lo que el sistema ya ha desplazado y hace que la barra suba de más), se mide
  // cuánto se solapa realmente el teclado con la posición actual del contenido y solo se
  // compensa esa diferencia.
  const refContenidoEditor = useRef<View>(null);
  const [alturaTeclado, setAlturaTeclado] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const mostrar = Keyboard.addListener('keyboardDidShow', e => {
      const tecladoArriba = e.endCoordinates.screenY;
      refContenidoEditor.current?.measureInWindow((_x, y, _w, alto) => {
        const solape = y + alto - tecladoArriba;
        setAlturaTeclado(solape > 0 ? solape : 0);
      });
    });
    const ocultar = Keyboard.addListener('keyboardDidHide', () => setAlturaTeclado(0));
    return () => {
      mostrar.remove();
      ocultar.remove();
    };
  }, []);

  const editor = useEditorBridge({
    initialContent: nota?.contenido || '',
    avoidIosKeyboard: true,
    theme: { webview: { backgroundColor: tema.fondo } },
    bridgeExtensions: [
      ...TenTapStartKit,
      crearBridgeTema(tema),
      PlaceholderBridge.configureExtension({ placeholder: 'Escribe tu nota aquí...' }),
    ],
  });
  const editorState = useBridgeState(editor);

  useEffect(() => {
    if (editorState.isReady) {
      editor.injectJS(JS_MANTENER_CURSOR_EN_TAREAS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorState.isReady]);

  const copiarPinAlPortapapeles = async (pin: string) => {
    if (!pin) return;
    await Clipboard.setStringAsync(pin);
    setPinCopiado(true);
    setTimeout(() => setPinCopiado(false), 2000);
  };

  const alternarCompartida = async () => {
    const nuevoValor = !esCompartidaInput;
    setEsCompartidaInput(nuevoValor);
    if (nuevoValor && !pinInput) {
      const [pin, sal] = await Promise.all([generarPin(), generarSalBase64()]);
      setPinInput(pin);
      setSalInput(sal);
    }
  };

  const elegirDuracion = (horas: number) => {
    setExpiraEnInput(Date.now() + horas * 60 * 60 * 1000);
    setMostrarOpcionesCaducidad(false);
  };

  const quitarCaducidad = () => {
    setExpiraEnInput(undefined);
    setMostrarOpcionesCaducidad(false);
  };

  const seleccionarImagen = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso denegado', 'Necesitamos acceso a tu galería para añadir imágenes.');
      return;
    }
    const resultado = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
    });
    const imagen = resultado.assets?.[0];
    if (resultado.canceled || !imagen?.base64) return;

    const mime = imagen.mimeType || 'image/jpeg';
    editor.setImage(`data:${mime};base64,${imagen.base64}`);
    // Para notas compartidas, cifrarContenidoNota() se encarga de subir esta imagen a Storage
    // (cifrada) y sustituir este data URI por su URL cuando la nota se envíe a Supabase.
  };

  const guardar = async (forzar: boolean = false) => {
    const contenido = await editor.getHTML();

    if (!esCompartidaInput || !pinInput || !salInput) {
      // Se acaba de desactivar "Compartida" en una nota que sí llegó a existir en Supabase:
      // salir/borrar en la nube antes de dejarla como solo local. Best-effort — si falla por no
      // haber red, se desmarca igualmente en el dispositivo en vez de bloquear al usuario.
      if (nota?.notaCompartidaId) {
        try {
          if (nota.esCreador) {
            await borrarNotaCompartidaDelServidor(nota.notaCompartidaId);
          } else {
            await salirDeNotaCompartida(nota.notaCompartidaId);
          }
        } catch (error) {
          console.error('Error al salir de la nota compartida en Supabase:', error);
          Alert.alert(
            'Aviso',
            'No se ha podido avisar a la nube de que has dejado de compartir esta nota (puede que siga apareciendo para otros). Se ha desmarcado igualmente en este dispositivo.'
          );
        }
      }

      onSave({ titulo: tituloInput, contenido, esCompartida: esCompartidaInput, expiraEn: expiraEnInput });
      return;
    }

    setGuardando(true);
    try {
      const clave = await derivarClaveDesdePin(pinInput, salInput);
      let notaCompartidaId = nota?.notaCompartidaId;
      let esCreador = nota?.esCreador ?? true;

      if (notaCompartidaId) {
        await guardarNotaCompartida({
          notaId: notaCompartidaId,
          titulo: tituloInput,
          contenidoHtml: contenido,
          clave,
          ultimaEdicionConocida: nota?.ultimaEdicionConocida ?? null,
          forzar,
        });
      } else {
        notaCompartidaId = await crearNotaCompartida({
          pin: pinInput,
          salCifrado: salInput,
          titulo: tituloInput,
          contenidoHtml: contenido,
          nombreCreador: nombreCreadorInput.trim() || 'Yo',
        });
        esCreador = true;
      }

      onSave({
        titulo: tituloInput,
        contenido,
        esCompartida: true,
        expiraEn: expiraEnInput,
        pinAcceso: pinInput,
        salCifrado: salInput,
        notaCompartidaId,
        esCreador,
      });
    } catch (error) {
      if (error instanceof ConflictoEdicionError) {
        setConflicto(error);
        return;
      }
      console.error('Error al guardar la nota compartida en Supabase:', error);
      Alert.alert('Error al guardar', mensajeDeError(error, 'No se ha podido guardar en la nube.'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.modalContainer}>

        {/* Barra superior */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.botonIcono}>
            <Feather name="arrow-left" size={22} color={tema.textoIcono} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.badgeSelector, esCompartidaInput ? styles.badgeCompartida : styles.badgeLocal]}
            onPress={alternarCompartida}
          >
            <Feather
              name={esCompartidaInput ? "share-2" : "lock"}
              size={12}
              color={esCompartidaInput ? "#ff6b00" : tema.textoIcono}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.badgeText, esCompartidaInput && styles.badgeTextCompartida]}>
              {esCompartidaInput ? 'Compartida con PIN' : 'Solo Local'}
            </Text>
          </TouchableOpacity>

          <View style={styles.modalAccionesDerecha}>
            <TouchableOpacity onPress={() => setMostrarOpcionesCaducidad(true)} style={styles.botonBorrar}>
              <Feather name="clock" size={20} color={expiraEnInput !== undefined ? '#ff6b00' : tema.textoIcono} />
            </TouchableOpacity>
            {esCompartidaInput && nota?.esCreador && nota?.notaCompartidaId && (
              <TouchableOpacity onPress={() => setMostrarParticipantes(true)} style={styles.botonBorrar}>
                <Feather name="users" size={20} color={tema.textoIcono} />
              </TouchableOpacity>
            )}
            {nota && (
              <TouchableOpacity onPress={onDelete} style={styles.botonBorrar}>
                <Feather name="trash-2" size={20} color="#ff4444" />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={guardando ? undefined : () => guardar()} disabled={guardando}>
              {guardando ? (
                <ActivityIndicator color="#ff6b00" />
              ) : (
                <Text style={styles.modalBotonGuardar}>Guardar</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Banner de PIN interactivo */}
        {esCompartidaInput && (
          <TouchableOpacity
            style={styles.pinBanner}
            activeOpacity={0.7}
            onPress={() => pinInput && copiarPinAlPortapapeles(pinInput)}
          >
            <View style={styles.pinInfo}>
              <Feather name="key" size={14} color="#ff6b00" style={{ marginRight: 8 }} />
              <Text style={styles.pinText}>
                PIN: <Text style={styles.pinCodigo}>{pinInput || 'Generando...'}</Text>
              </Text>
            </View>
            <View style={styles.copiarAccion}>
              <Feather
                name={pinCopiado ? "check" : "copy"}
                size={14}
                color={pinCopiado ? "#00ff88" : tema.textoIcono}
              />
              <Text style={[styles.copiarTexto, pinCopiado && styles.copiarTextoExito]}>
                {pinCopiado ? '¡Copiado!' : 'Copiar'}
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Nombre del creador: solo hace falta la primera vez que se comparte (aún no existe en Supabase) */}
        {esCompartidaInput && !nota?.notaCompartidaId && (
          <TextInput
            style={styles.inputNombreCreador}
            placeholder="Tu nombre (se lo verán los demás)"
            placeholderTextColor={tema.textoTerciario}
            value={nombreCreadorInput}
            onChangeText={setNombreCreadorInput}
          />
        )}

        {/* Panel de opciones de caducidad (Alert.alert no soporta más de 3 botones en Android) */}
        <Modal
          visible={mostrarOpcionesCaducidad}
          transparent
          animationType="fade"
          onRequestClose={() => setMostrarOpcionesCaducidad(false)}
        >
          <TouchableOpacity
            style={styles.opcionesFondo}
            activeOpacity={1}
            onPress={() => setMostrarOpcionesCaducidad(false)}
          >
            <TouchableOpacity
              style={[styles.opcionesTarjeta, { paddingBottom: Math.max(20, insets.bottom + 12) }]}
              activeOpacity={1}
              onPress={() => {}}
            >
              <Text style={styles.opcionesTitulo}>Autodestrucción</Text>
              <Text style={styles.opcionesSubtitulo}>
                {expiraEnInput !== undefined
                  ? `Se borra el ${formatoFechaHora(expiraEnInput)}.`
                  : 'Pasado ese tiempo la nota se borrará automáticamente.'}
              </Text>

              {OPCIONES_CADUCIDAD.map(o => (
                <TouchableOpacity key={o.horas} style={styles.opcionFila} onPress={() => elegirDuracion(o.horas)}>
                  <Text style={styles.opcionTexto}>{o.texto}</Text>
                </TouchableOpacity>
              ))}

              {expiraEnInput !== undefined && (
                <TouchableOpacity style={styles.opcionFila} onPress={quitarCaducidad}>
                  <Text style={[styles.opcionTexto, styles.opcionTextoQuitar]}>Quitar caducidad</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={styles.opcionFila} onPress={() => setMostrarOpcionesCaducidad(false)}>
                <Text style={[styles.opcionTexto, styles.opcionTextoCancelar]}>Cancelar</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Panel de conflicto al guardar (Alert.alert es del sistema operativo, no se puede pintar
            con los colores del tema — por eso este, igual que el de arriba, es propio) */}
        <Modal
          visible={!!conflicto}
          transparent
          animationType="fade"
          onRequestClose={() => setConflicto(null)}
        >
          <TouchableOpacity style={styles.opcionesFondo} activeOpacity={1} onPress={() => setConflicto(null)}>
            <TouchableOpacity
              style={[styles.opcionesTarjeta, { paddingBottom: Math.max(20, insets.bottom + 12) }]}
              activeOpacity={1}
              onPress={() => {}}
            >
              <Text style={styles.opcionesTitulo}>Alguien más ha editado esta nota</Text>
              <Text style={styles.opcionesSubtitulo}>
                {conflicto?.editadoPor ?? 'Otra persona'} ha guardado cambios mientras la tenías abierta. ¿Qué quieres hacer?
              </Text>

              <TouchableOpacity style={styles.opcionFila} onPress={() => setConflicto(null)}>
                <Text style={[styles.opcionTexto, styles.opcionTextoCancelar]}>Seguir editando</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.opcionFila}
                onPress={() => {
                  setConflicto(null);
                  guardar(true);
                }}
              >
                <Text style={[styles.opcionTexto, styles.opcionTextoDestacado]}>Sobrescribir con los míos</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.opcionFila}
                onPress={() => {
                  setConflicto(null);
                  onClose();
                }}
              >
                <Text style={[styles.opcionTexto, styles.opcionTextoQuitar]}>Descartar mis cambios</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Cuerpo del editor + barra de herramientas */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View ref={refContenidoEditor} style={{ flex: 1, paddingBottom: alturaTeclado }}>
          <View style={styles.editorBody}>
            <TextInput
              style={styles.inputTitulo}
              placeholder="Título"
              placeholderTextColor={tema.textoTerciario}
              value={tituloInput}
              onChangeText={setTituloInput}
            />

            <RichText editor={editor} />
          </View>

          {/* Barra de herramientas */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.toolbar}
            contentContainerStyle={styles.toolbarContent}
            keyboardShouldPersistTaps="always"
          >
            <TouchableOpacity style={styles.toolbarBtn} onPress={seleccionarImagen}>
              <Feather name="image" size={20} color={tema.textoIcono} />
            </TouchableOpacity>

            <View style={styles.toolbarDivider} />

            <TouchableOpacity style={styles.toolbarBtn} onPress={() => editor.toggleTaskList()}>
              <Feather name="check-square" size={20} color={editorState.isTaskListActive ? '#ff6b00' : tema.textoIcono} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.toolbarBtn} onPress={() => editor.toggleBulletList()}>
              <Feather name="list" size={20} color={editorState.isBulletListActive ? '#ff6b00' : tema.textoIcono} />
            </TouchableOpacity>

            <View style={styles.toolbarDivider} />

            <TouchableOpacity style={styles.toolbarBtn} onPress={() => editor.toggleBold()}>
              <Text style={[styles.toolbarBtnText, editorState.isBoldActive && styles.toolbarBtnTextActivo]}>B</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.toolbarBtn} onPress={() => editor.toggleItalic()}>
              <Text style={[styles.toolbarBtnText, { fontStyle: 'italic' }, editorState.isItalicActive && styles.toolbarBtnTextActivo]}>I</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.toolbarBtn} onPress={() => editor.toggleStrike()}>
              <Text style={[styles.toolbarBtnText, { textDecorationLine: 'line-through' }, editorState.isStrikeActive && styles.toolbarBtnTextActivo]}>S</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.toolbarBtn} onPress={() => editor.toggleCode()}>
              <Feather name="code" size={20} color={editorState.isCodeActive ? '#ff6b00' : tema.textoIcono} />
            </TouchableOpacity>

            <View style={styles.toolbarDivider} />

            <TouchableOpacity
              style={styles.toolbarBtn}
              onPress={() => editor.undo()}
              disabled={!editorState.canUndo}
            >
              <Feather name="corner-up-left" size={20} color={editorState.canUndo ? tema.textoIcono : tema.textoTerciario} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolbarBtn}
              onPress={() => editor.redo()}
              disabled={!editorState.canRedo}
            >
              <Feather name="corner-up-right" size={20} color={editorState.canRedo ? tema.textoIcono : tema.textoTerciario} />
            </TouchableOpacity>
          </ScrollView>
          </View>
        </KeyboardAvoidingView>

      </SafeAreaView>

      <ModalParticipantes
        visible={mostrarParticipantes}
        notaCompartidaId={nota?.notaCompartidaId ?? null}
        onClose={() => setMostrarParticipantes(false)}
      />
    </Modal>
  );
}

const crearEstilos = (t: Tema) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.fondo },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 10,
  },
  botonUnirse: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.superficie,
    borderWidth: 1,
    borderColor: t.borde,
    justifyContent: 'center',
    alignItems: 'center',
  },
  botonTema: { marginLeft: 10 },
  headerTitle: { fontSize: 30, fontWeight: '700', color: '#ffffff', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, color: t.textoSecundario, marginTop: 2 },

  busquedaFila: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.superficie,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.borde,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  busquedaInput: { flex: 1, color: '#fff', fontSize: 14 },

  listContent: { paddingHorizontal: 12, paddingBottom: 200 },
  columnWrapper: { justifyContent: 'space-between' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyText: { color: t.textoTerciario, fontSize: 14, marginTop: 10 },

  card: {
    backgroundColor: t.superficie,
    width: '48%',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    minHeight: 125,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: t.borde,
  },
  cardCargando: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `${t.superficie}ee`,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  cardHeader: { marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#ececec', lineHeight: 20 },
  cardContent: { fontSize: 12, color: t.textoSecundarioAlt, lineHeight: 17, marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' },
  cardDate: { fontSize: 11, color: t.textoTerciario },

  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  badgeSelector: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  badgeLocal: { backgroundColor: t.borde },
  badgeCompartida: { backgroundColor: '#2a1a10', borderWidth: 1, borderColor: '#ff6b0033' },
  badgeText: { fontSize: 11, fontWeight: '500', color: t.textoIcono },
  badgeTextCompartida: { color: '#ff6b00' },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 95,
    backgroundColor: '#ff6b00',
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },

  barraInferior: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.superficie,
    borderTopWidth: 1,
    borderTopColor: t.borde,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 12,
  },
  // Dos mitades de ancho EXACTAMENTE igual (flex:1 cada una): el borde entre ellas cae siempre en
  // el 50% real de la barra, sin importar cuántos botones tenga cada lado. Dentro de cada mitad, los
  // botones se empujan hacia ese borde (hacia el centro), para quedar pegados a la lupa.
  barraMitad: { flex: 1, flexDirection: 'row' },
  barraMitadIzquierda: { justifyContent: 'flex-end', paddingRight: 34 },
  barraMitadDerecha: { justifyContent: 'flex-start', paddingLeft: 25 },
  barraBoton: { alignItems: 'center', justifyContent: 'center', width: 76 },
  barraTexto: { fontSize: 10, color: t.textoIcono, marginTop: 3, fontWeight: '500' },
  barraTextoActivo: { color: '#ff6b00' },
  barraBotonCentro: {
    position: 'absolute',
    left: '50%',
    marginLeft: -0,
    top: 2,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: t.fondo,
    borderWidth: 1,
    borderColor: t.bordeFuerte,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barraBotonCentroActivo: {
    backgroundColor: '#ff6b00',
    borderColor: '#ff6b00',
  },

  modalContainer: { flex: 1, backgroundColor: t.fondo },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: t.superficie,
  },
  botonIcono: { padding: 4 },
  modalAccionesDerecha: { flexDirection: 'row', alignItems: 'center' },
  botonBorrar: { marginRight: 15, padding: 4 },
  modalBotonGuardar: { color: '#ff6b00', fontSize: 15, fontWeight: '600' },

  pinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.superficie,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 15,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: t.borde,
  },
  pinInfo: { flexDirection: 'row', alignItems: 'center' },
  pinText: { color: t.textoIcono, fontSize: 12 },
  pinCodigo: { color: '#ff6b00', fontWeight: 'bold', fontSize: 13 },
  copiarAccion: { flexDirection: 'row', alignItems: 'center' },
  copiarTexto: { fontSize: 11, color: t.textoIcono, marginLeft: 4, fontWeight: '500' },
  copiarTextoExito: { color: '#00ff88' },

  opcionesFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  opcionesTarjeta: {
    backgroundColor: t.superficie,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  opcionesTitulo: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 4 },
  opcionesSubtitulo: { fontSize: 12, color: t.textoSecundarioAlt, marginBottom: 12 },
  opcionFila: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: t.borde },
  opcionTexto: { fontSize: 15, color: '#ccc' },
  opcionTextoQuitar: { color: '#ff4444' },
  opcionTextoCancelar: { color: t.textoIcono },
  opcionTextoDestacado: { color: '#ff6b00', fontWeight: '600' },

  inputNombreCreador: {
    backgroundColor: t.superficie,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.borde,
    marginTop: 12,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 13,
  },

  editorBody: { flex: 1, marginTop: 15, paddingHorizontal: 20 },
  inputTitulo: { fontSize: 22, fontWeight: '700', color: '#ff6b00', marginBottom: 15 },

  toolbar: {
    height: 44,
    flexGrow: 0.03,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: t.superficie,
    backgroundColor: t.fondo,
  },
  toolbarContent: { paddingHorizontal: 5, alignItems: 'center', height: 54 },
  toolbarBtn: { paddingVertical: 6, paddingHorizontal: 9, marginHorizontal: 1 },
  toolbarBtnText: { fontSize: 30, fontWeight: '700', color: t.textoIcono },
  toolbarBtnTextActivo: { color: '#ff6b00' },
  toolbarDivider: { width: 0.8, height: 20, backgroundColor: t.borde, marginHorizontal: 4 },
});
