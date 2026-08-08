import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { cambiarPermisoEscritura, listarParticipantes, Participante, revocarParticipante } from '../lib/notasCompartidas';
import { mensajeDeError } from '../lib/errores';

export default function ModalParticipantes({
  visible,
  notaCompartidaId,
  onClose,
}: {
  visible: boolean;
  notaCompartidaId: string | null;
  onClose: () => void;
}) {
  const [participantes, setParticipantes] = useState<Participante[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!notaCompartidaId) return;
    setCargando(true);
    try {
      setParticipantes(await listarParticipantes(notaCompartidaId));
    } catch (error) {
      console.error('Error al listar participantes:', error);
      Alert.alert('Error', mensajeDeError(error, 'No se ha podido cargar la lista de participantes.'));
    } finally {
      setCargando(false);
    }
  }, [notaCompartidaId]);

  useEffect(() => {
    if (visible) cargar();
  }, [visible, cargar]);

  const alternarEscritura = async (participante: Participante, valor: boolean) => {
    setParticipantes(prev => prev.map(p => (p.id === participante.id ? { ...p, puedeEscribir: valor } : p)));
    try {
      await cambiarPermisoEscritura(participante.id, valor);
    } catch (error) {
      console.error('Error al cambiar el permiso de escritura:', error);
      setParticipantes(prev => prev.map(p => (p.id === participante.id ? { ...p, puedeEscribir: !valor } : p)));
      Alert.alert('Error', mensajeDeError(error, 'No se ha podido cambiar el permiso.'));
    }
  };

  const expulsar = (participante: Participante) => {
    Alert.alert('Quitar acceso', `¿Seguro que quieres quitarle el acceso a ${participante.nombreUsuario}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          try {
            await revocarParticipante(participante.id);
            setParticipantes(prev => prev.filter(p => p.id !== participante.id));
          } catch (error) {
            console.error('Error al quitar el acceso:', error);
            Alert.alert('Error', mensajeDeError(error, 'No se ha podido quitar el acceso.'));
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.fondo}>
        <View style={styles.tarjeta}>
          <View style={styles.cabecera}>
            <Text style={styles.titulo}>Quién tiene acceso</Text>
            <TouchableOpacity onPress={onClose}>
              <Feather name="x" size={22} color="#8890A3" />
            </TouchableOpacity>
          </View>

          {cargando ? (
            <ActivityIndicator color="#ff6b00" style={{ marginVertical: 20 }} />
          ) : (
            <FlatList
              data={participantes}
              keyExtractor={p => p.id}
              style={styles.lista}
              ListEmptyComponent={<Text style={styles.vacio}>Nadie se ha unido todavía.</Text>}
              renderItem={({ item }) => (
                <View style={styles.fila}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nombre}>
                      {item.nombreUsuario}
                      {item.esCreador ? ' (tú, creador)' : ''}
                    </Text>
                    {!item.esCreador && (
                      <Text style={styles.escritura}>{item.puedeEscribir ? 'Puede editar' : 'Solo lectura'}</Text>
                    )}
                  </View>
                  {!item.esCreador && (
                    <>
                      <Switch
                        value={item.puedeEscribir}
                        onValueChange={valor => alternarEscritura(item, valor)}
                        trackColor={{ false: '#333B4E', true: '#ff6b0088' }}
                        thumbColor={item.puedeEscribir ? '#ff6b00' : '#8890A3'}
                      />
                      <TouchableOpacity onPress={() => expulsar(item)} style={styles.botonQuitar}>
                        <Feather name="user-x" size={18} color="#ff4444" />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  tarjeta: {
    backgroundColor: '#182033',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#222A3D',
    maxHeight: '80%',
  },
  cabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  titulo: { fontSize: 17, fontWeight: '700', color: '#fff' },
  lista: { maxHeight: 320 },
  vacio: { color: '#555D70', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#222A3D',
  },
  nombre: { color: '#ececec', fontSize: 15, fontWeight: '600' },
  escritura: { color: '#777F92', fontSize: 12, marginTop: 2 },
  botonQuitar: { marginLeft: 12, padding: 4 },
});
