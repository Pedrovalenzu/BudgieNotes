import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  StatusBar,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEditorBridge, RichText, useBridgeState, BridgeExtension, TenTapStartKit, PlaceholderBridge } from '@10play/tentap-editor';
import { generarPin } from './lib/pin';
import { generarSalBase64, derivarClaveDesdePin } from './lib/cifrado';
import { asegurarSesionAnonima } from './lib/auth';
import { supabase } from './lib/supabase';
import { cargarNotaCompartida, crearNotaCompartida, guardarNotaCompartida, unirseANotaPorPin } from './lib/notasCompartidas';
import { mensajeDeError } from './lib/errores';
import { Nota } from './types';
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

const CSS_EDITOR = `
  html, body { background-color: #0f0f0f; margin: 0; }
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
    background-color: #1a1a1a;
    color: #00ff88 !important;
    padding: 2px 5px;
    border-radius: 4px;
    font-size: 0.85em;
  }
  s { color: #666 !important; }
  img {
    border-radius: 10px;
    margin: 8px 0;
  }
  ul[data-type="taskList"] li > label > input {
    border: 1px solid #555 !important;
    background: #1a1a1a !important;
    accent-color: #ff6b00;
  }
  .is-editor-empty:first-child::before { color: #333; }
`;

// Va en bridgeExtensions (no injectCSS) para que se aplique al cargar, sin el texto negro por defecto de por medio
const BridgeTemaOscuro = new BridgeExtension({
  forceName: 'temaOscuro',
  extendCSS: CSS_EDITOR,
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

export default function App() {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [cargando, setCargando] = useState(true);

  // Estados del Editor
  const [modalVisible, setModalVisible] = useState(false);
  const [notaSeleccionada, setNotaSeleccionada] = useState<Nota | null>(null);
  const [editorSession, setEditorSession] = useState(0);
  const [mostrarUnirse, setMostrarUnirse] = useState(false);
  const [cargandoNotaId, setCargandoNotaId] = useState<string | null>(null);

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
      const { titulo, contenidoHtml } = await cargarNotaCompartida(nota.notaCompartidaId, clave);
      notaParaAbrir = { ...nota, titulo, contenido: contenidoHtml };

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

  // 4. BORRAR UNA NOTA
  const borrarNota = () => {
    if (!notaSeleccionada) return;

    Alert.alert(
      'Borrar nota',
      '¿Seguro que quieres borrar esta nota? Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () => {
            const notasFiltradas = notas.filter(n => n.id !== notaSeleccionada.id);
            setNotas(notasFiltradas);
            guardarEnStorage(notasFiltradas);
            setModalVisible(false);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f0f" />

      {/* Cabecera */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Budgie Notes</Text>
          <Text style={styles.headerSubtitle}>
            {cargando ? 'Cargando...' : `${notas.length} notas guardadas`}
          </Text>
        </View>
        <TouchableOpacity style={styles.botonUnirse} onPress={() => setMostrarUnirse(true)}>
          <Feather name="user-plus" size={20} color="#888" />
        </TouchableOpacity>
      </View>

      {/* Grid de Tarjetas */}
      <FlatList
        data={notas}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={() => (
          !cargando ? (
            <View style={styles.emptyContainer}>
              <Feather name="file-text" size={40} color="#333" />
              <Text style={styles.emptyText}>No tienes notas guardadas.</Text>
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
                    color={item.esCompartida ? "#ff6b00" : "#888"}
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
      <TouchableOpacity style={styles.fab} activeOpacity={0.8} onPress={abrirCreador}>
        <Feather name="plus" size={26} color="#ffffff" />
      </TouchableOpacity>

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
      />
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

  const editor = useEditorBridge({
    initialContent: nota?.contenido || '',
    avoidIosKeyboard: true,
    theme: { webview: { backgroundColor: '#0f0f0f' } },
    bridgeExtensions: [
      ...TenTapStartKit,
      BridgeTemaOscuro,
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

  const guardar = async () => {
    const contenido = await editor.getHTML();

    if (!esCompartidaInput || !pinInput || !salInput) {
      onSave({ titulo: tituloInput, contenido, esCompartida: esCompartidaInput, expiraEn: expiraEnInput });
      return;
    }

    setGuardando(true);
    try {
      const clave = await derivarClaveDesdePin(pinInput, salInput);
      let notaCompartidaId = nota?.notaCompartidaId;
      let esCreador = nota?.esCreador ?? true;

      if (notaCompartidaId) {
        await guardarNotaCompartida({ notaId: notaCompartidaId, titulo: tituloInput, contenidoHtml: contenido, clave });
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
      console.error('Error al guardar la nota compartida en Supabase:', error);
      Alert.alert('Error al guardar', mensajeDeError(error, 'No se ha podido guardar en la nube.'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <SafeAreaView style={styles.modalContainer}>

        {/* Barra superior */}
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.botonIcono}>
            <Feather name="arrow-left" size={22} color="#888" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.badgeSelector, esCompartidaInput ? styles.badgeCompartida : styles.badgeLocal]}
            onPress={alternarCompartida}
          >
            <Feather
              name={esCompartidaInput ? "share-2" : "lock"}
              size={12}
              color={esCompartidaInput ? "#ff6b00" : "#888"}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.badgeText, esCompartidaInput && styles.badgeTextCompartida]}>
              {esCompartidaInput ? 'Compartida con PIN' : 'Solo Local'}
            </Text>
          </TouchableOpacity>

          <View style={styles.modalAccionesDerecha}>
            {esCompartidaInput && nota?.esCreador && nota?.notaCompartidaId && (
              <TouchableOpacity onPress={() => setMostrarParticipantes(true)} style={styles.botonBorrar}>
                <Feather name="users" size={20} color="#888" />
              </TouchableOpacity>
            )}
            {nota && (
              <TouchableOpacity onPress={onDelete} style={styles.botonBorrar}>
                <Feather name="trash-2" size={20} color="#ff4444" />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={guardando ? undefined : guardar} disabled={guardando}>
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
                color={pinCopiado ? "#00ff88" : "#888"}
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
            placeholderTextColor="#444"
            value={nombreCreadorInput}
            onChangeText={setNombreCreadorInput}
          />
        )}

        {/* Banner de autodestrucción */}
        <TouchableOpacity
          style={styles.pinBanner}
          activeOpacity={0.7}
          onPress={() => setMostrarOpcionesCaducidad(true)}
        >
          <View style={styles.pinInfo}>
            <Feather name="clock" size={14} color={expiraEnInput !== undefined ? '#ff6b00' : '#888'} style={{ marginRight: 8 }} />
            <Text style={styles.pinText}>
              {expiraEnInput !== undefined
                ? <>Se borra el <Text style={styles.pinCodigo}>{formatoFechaHora(expiraEnInput)}</Text></>
                : 'Sin caducidad'}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color="#888" />
        </TouchableOpacity>

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
            <TouchableOpacity style={styles.opcionesTarjeta} activeOpacity={1} onPress={() => {}}>
              <Text style={styles.opcionesTitulo}>Autodestrucción</Text>
              <Text style={styles.opcionesSubtitulo}>Pasado ese tiempo la nota se borrará automáticamente.</Text>

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

        {/* Cuerpo del editor + barra de herramientas */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.editorBody}>
            <TextInput
              style={styles.inputTitulo}
              placeholder="Título"
              placeholderTextColor="#444"
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
              <Feather name="image" size={20} color="#888" />
            </TouchableOpacity>

            <View style={styles.toolbarDivider} />

            <TouchableOpacity style={styles.toolbarBtn} onPress={() => editor.toggleTaskList()}>
              <Feather name="check-square" size={20} color={editorState.isTaskListActive ? '#ff6b00' : '#888'} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.toolbarBtn} onPress={() => editor.toggleBulletList()}>
              <Feather name="list" size={20} color={editorState.isBulletListActive ? '#ff6b00' : '#888'} />
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
              <Feather name="code" size={20} color={editorState.isCodeActive ? '#ff6b00' : '#888'} />
            </TouchableOpacity>
          </ScrollView>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
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
    backgroundColor: '#181818',
    borderWidth: 1,
    borderColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 30, fontWeight: '700', color: '#ffffff', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, color: '#555555', marginTop: 2 },
  listContent: { paddingHorizontal: 12, paddingBottom: 90 },
  columnWrapper: { justifyContent: 'space-between' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyText: { color: '#444', fontSize: 14, marginTop: 10 },

  card: {
    backgroundColor: '#181818',
    width: '48%',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    minHeight: 125,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#222222',
  },
  cardCargando: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#181818ee',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  cardHeader: { marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#ececec', lineHeight: 20 },
  cardContent: { fontSize: 12, color: '#777777', lineHeight: 17, marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' },
  cardDate: { fontSize: 11, color: '#444444' },

  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  badgeSelector: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  badgeLocal: { backgroundColor: '#222222' },
  badgeCompartida: { backgroundColor: '#2a1a10', borderWidth: 1, borderColor: '#ff6b0033' },
  badgeText: { fontSize: 11, fontWeight: '500', color: '#888888' },
  badgeTextCompartida: { color: '#ff6b00' },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    backgroundColor: '#ff6b00',
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },

  modalContainer: { flex: 1, backgroundColor: '#0f0f0f' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  botonIcono: { padding: 4 },
  modalAccionesDerecha: { flexDirection: 'row', alignItems: 'center' },
  botonBorrar: { marginRight: 15, padding: 4 },
  modalBotonGuardar: { color: '#ff6b00', fontSize: 15, fontWeight: '600' },

  pinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#181818',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 15,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: '#222'
  },
  pinInfo: { flexDirection: 'row', alignItems: 'center' },
  pinText: { color: '#888', fontSize: 12 },
  pinCodigo: { color: '#ff6b00', fontWeight: 'bold', fontSize: 13 },
  copiarAccion: { flexDirection: 'row', alignItems: 'center' },
  copiarTexto: { fontSize: 11, color: '#888', marginLeft: 4, fontWeight: '500' },
  copiarTextoExito: { color: '#00ff88' },

  opcionesFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  opcionesTarjeta: {
    backgroundColor: '#181818',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 34,
  },
  opcionesTitulo: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 4 },
  opcionesSubtitulo: { fontSize: 12, color: '#777', marginBottom: 12 },
  opcionFila: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#222' },
  opcionTexto: { fontSize: 15, color: '#ccc' },
  opcionTextoQuitar: { color: '#ff4444' },
  opcionTextoCancelar: { color: '#888' },

  inputNombreCreador: {
    backgroundColor: '#181818',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    marginTop: 12,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 13,
  },

  editorBody: { flex: 1, marginTop: 15, paddingHorizontal: 20 },
  inputTitulo: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 15 },

  toolbar: {
    height: 44,
    flexGrow: 0.03,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    backgroundColor: '#0f0f0f',
  },
  toolbarContent: { paddingHorizontal: 19, alignItems: 'center', height: 54 },
  toolbarBtn: { paddingVertical: 6, paddingHorizontal: 10, marginHorizontal: 1 },
  toolbarBtnText: { fontSize: 30, fontWeight: '700', color: '#888' },
  toolbarBtnTextActivo: { color: '#ff6b00' },
  toolbarDivider: { width: 1, height: 20, backgroundColor: '#222', marginHorizontal: 4 },
});
