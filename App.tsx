import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  FlatList, 
  SafeAreaView, 
  StatusBar,
  Modal,
  TextInput
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
// Importamos AsyncStorage para persistencia en disco
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Nota {
  id: string;
  titulo: string;
  contenido: string;
  esCompartida: boolean;
  pinAcceso?: string;
  fecha: string;
}

const CLAVE_STORAGE = '@mis_notas_locales';

export default function App() {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [cargando, setCargando] = useState(true);

  // Estados del Editor
  const [modalVisible, setModalVisible] = useState(false);
  const [notaSeleccionada, setNotaSeleccionada] = useState<Nota | null>(null);
  const [tituloInput, setTituloInput] = useState('');
  const [contenidoInput, setContenidoInput] = useState('');
  const [esCompartidaInput, setEsCompartidaInput] = useState(false);
  const [pinCopiado, setPinCopiado] = useState(false);

  // 1. CARGAR NOTAS DEL MÓVIL AL ABRIR LA APP
  useEffect(() => {
    cargarNotasGuardadas();
  }, []);

  const cargarNotasGuardadas = async () => {
    try {
      const datosJson = await AsyncStorage.getItem(CLAVE_STORAGE);
      if (datosJson !== null) {
        setNotas(JSON.parse(datosJson));
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

  const copiarPinAlPortapapeles = async (pin: string) => {
    if (!pin) return;
    await Clipboard.setStringAsync(pin);
    setPinCopiado(true);
    setTimeout(() => setPinCopiado(false), 2000);
  };

  const abrirCreador = () => {
    setNotaSeleccionada(null);
    setTituloInput('');
    setContenidoInput('');
    setEsCompartidaInput(false);
    setPinCopiado(false);
    setModalVisible(true);
  };

  const abrirEditor = (nota: Nota) => {
    setNotaSeleccionada(nota);
    setTituloInput(nota.titulo);
    setContenidoInput(nota.contenido);
    setEsCompartidaInput(nota.esCompartida);
    setPinCopiado(false);
    setModalVisible(true);
  };

  // 3. GUARDAR CAMBIOS (CREAR / EDITAR / ELIMINAR)
  const guardarNota = () => {
    if (!tituloInput.trim() && !contenidoInput.trim()) {
      setModalVisible(false);
      return;
    }

    let notasActualizadas: Nota[];

    if (notaSeleccionada) {
      // Modificar nota existente
      notasActualizadas = notas.map(n => n.id === notaSeleccionada.id ? {
        ...n,
        titulo: tituloInput,
        contenido: contenidoInput,
        esCompartida: esCompartidaInput,
        pinAcceso: esCompartidaInput ? (n.pinAcceso || 'K9F-X2') : undefined
      } : n);
    } else {
      // Crear nota nueva
      const nuevaNota: Nota = {
        id: Date.now().toString(),
        titulo: tituloInput || 'Sin título',
        contenido: contenidoInput,
        esCompartida: esCompartidaInput,
        pinAcceso: esCompartidaInput ? 'K9F-X2' : undefined,
        fecha: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
      };
      notasActualizadas = [nuevaNota, ...notas];
    }

    // Actualizar el estado visual Y persistir en el disco del móvil
    setNotas(notasActualizadas);
    guardarEnStorage(notasActualizadas);
    setModalVisible(false);
  };

  // 4. BORRAR UNA NOTA
  const borrarNota = () => {
    if (!notaSeleccionada) return;
    
    const notasFiltradas = notas.filter(n => n.id !== notaSeleccionada.id);
    setNotas(notasFiltradas);
    guardarEnStorage(notasFiltradas);
    setModalVisible(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f0f0f" />
      
      {/* Cabecera */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notas</Text>
        <Text style={styles.headerSubtitle}>
          {cargando ? 'Cargando...' : `${notas.length} notas guardadas`}
        </Text>
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
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.titulo}
              </Text>
            </View>

            <Text style={styles.cardContent} numberOfLines={4}>
              {item.contenido || 'Nota vacía...'}
            </Text>

            <View style={styles.cardFooter}>
              <Text style={styles.cardDate}>{item.fecha}</Text>
              
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
          </TouchableOpacity>
        )}
      />

      {/* Botón Flotante */}
      <TouchableOpacity style={styles.fab} activeOpacity={0.8} onPress={abrirCreador}>
        <Feather name="plus" size={26} color="#ffffff" />
      </TouchableOpacity>

      {/* MODAL / EDITOR DE NOTAS */}
      <Modal visible={modalVisible} animationType="slide" transparent={false}>
        <SafeAreaView style={styles.modalContainer}>
          {/* Barra superior */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.botonIcono}>
              <Feather name="arrow-left" size={22} color="#888" />
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.badgeSelector, esCompartidaInput ? styles.badgeCompartida : styles.badgeLocal]}
              onPress={() => setEsCompartidaInput(!esCompartidaInput)}
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
              {notaSeleccionada && (
                <TouchableOpacity onPress={borrarNota} style={styles.botonBorrar}>
                  <Feather name="trash-2" size={20} color="#ff4444" />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={guardarNota}>
                <Text style={styles.modalBotonGuardar}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Banner de PIN interactivo */}
          {esCompartidaInput && (
            <TouchableOpacity 
              style={styles.pinBanner}
              activeOpacity={0.7}
              onPress={() => copiarPinAlPortapapeles(notaSeleccionada?.pinAcceso || 'K9F-X2')}
            >
              <View style={styles.pinInfo}>
                <Feather name="key" size={14} color="#ff6b00" style={{ marginRight: 8 }} />
                <Text style={styles.pinText}>
                  PIN: <Text style={styles.pinCodigo}>{notaSeleccionada?.pinAcceso || 'Se generará al guardar'}</Text>
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

          {/* Formulario */}
          <View style={styles.editorBody}>
            <TextInput
              style={styles.inputTitulo}
              placeholder="Título"
              placeholderTextColor="#444"
              value={tituloInput}
              onChangeText={setTituloInput}
            />
            <TextInput
              style={styles.inputContenido}
              placeholder="Escribe tu nota aquí..."
              placeholderTextColor="#333"
              multiline
              textAlignVertical="top"
              value={contenidoInput}
              onChangeText={setContenidoInput}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10 },
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

  modalContainer: { flex: 1, backgroundColor: '#0f0f0f', paddingHorizontal: 20 },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a'
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
    borderWidth: 1, 
    borderColor: '#222' 
  },
  pinInfo: { flexDirection: 'row', alignItems: 'center' },
  pinText: { color: '#888', fontSize: 12 },
  pinCodigo: { color: '#ff6b00', fontWeight: 'bold', fontSize: 13 },
  copiarAccion: { flexDirection: 'row', alignItems: 'center' },
  copiarTexto: { fontSize: 11, color: '#888', marginLeft: 4, fontWeight: '500' },
  copiarTextoExito: { color: '#00ff88' },

  editorBody: { flex: 1, marginTop: 15 },
  inputTitulo: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 15 },
  inputContenido: { flex: 1, fontSize: 15, color: '#ccc', lineHeight: 22 },
});