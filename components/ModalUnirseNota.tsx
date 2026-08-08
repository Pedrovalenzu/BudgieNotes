import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { cargarNotaCompartida, unirseANotaPorPin } from '../lib/notasCompartidas';
import { mensajeDeError } from '../lib/errores';
import { useTema } from '../lib/TemaContext';
import { Tema } from '../lib/tema';
import { Nota } from '../types';

export default function ModalUnirseNota({
  visible,
  onClose,
  onUnido,
  pinesUnidos,
}: {
  visible: boolean;
  onClose: () => void;
  onUnido: (nota: Nota) => void;
  pinesUnidos: string[];
}) {
  const { tema } = useTema();
  const styles = useMemo(() => crearEstilos(tema), [tema]);
  const [pin, setPin] = useState('');
  const [nombre, setNombre] = useState('');
  const [cargando, setCargando] = useState(false);

  const cerrar = () => {
    if (cargando) return;
    setPin('');
    setNombre('');
    onClose();
  };

  const unirse = async () => {
    const pinLimpio = pin.trim();

    if (!pinLimpio || !nombre.trim()) {
      Alert.alert('Faltan datos', 'Introduce el PIN de la nota y tu nombre.');
      return;
    }

    if (pinesUnidos.includes(pinLimpio)) {
      Alert.alert('Ya estás en esta nota', 'Esta nota compartida ya está en tu lista.');
      return;
    }

    setCargando(true);
    try {
      const { notaId, salCifrado, clave } = await unirseANotaPorPin(pinLimpio, nombre.trim());
      const { titulo, contenidoHtml } = await cargarNotaCompartida(notaId, clave);

      onUnido({
        id: Date.now().toString(),
        titulo,
        contenido: contenidoHtml,
        esCompartida: true,
        pinAcceso: pinLimpio,
        salCifrado,
        notaCompartidaId: notaId,
        esCreador: false,
        fecha: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
      });

      setPin('');
      setNombre('');
    } catch (error) {
      console.error('Error al unirse a la nota compartida:', error);
      Alert.alert('No se pudo unir', mensajeDeError(error, 'No se ha podido unir a la nota.'));
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cerrar}>
      <KeyboardAvoidingView style={styles.fondo} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.tarjeta}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Unirse a una nota</Text>
            <TouchableOpacity onPress={cerrar} disabled={cargando}>
              <Feather name="x" size={22} color={tema.textoIcono} />
            </TouchableOpacity>
          </View>

          <Text style={styles.etiqueta}>PIN de la nota</Text>
          <TextInput
            style={styles.input}
            placeholder="X7K9-P2M4-Q8RT-3WYL"
            placeholderTextColor={tema.textoTerciario}
            autoCapitalize="characters"
            autoCorrect={false}
            value={pin}
            onChangeText={setPin}
            editable={!cargando}
          />

          <Text style={styles.etiqueta}>Tu nombre</Text>
          <TextInput
            style={styles.input}
            placeholder="¿Cómo te llamas?"
            placeholderTextColor={tema.textoTerciario}
            value={nombre}
            onChangeText={setNombre}
            editable={!cargando}
          />

          <TouchableOpacity style={styles.boton} onPress={unirse} disabled={cargando}>
            {cargando ? <ActivityIndicator color={tema.fondo} /> : <Text style={styles.botonTexto}>Unirse</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const crearEstilos = (t: Tema) => StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  tarjeta: { backgroundColor: t.superficie, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: t.borde },
  cabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  titulo: { fontSize: 17, fontWeight: '700', color: '#fff' },
  etiqueta: { fontSize: 12, color: t.textoIcono, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: t.fondo,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.borde,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
  },
  boton: {
    backgroundColor: '#ff6b00',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  botonTexto: { color: t.fondo, fontWeight: '700', fontSize: 15 },
});
