# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical: Expo Version

**Always read the versioned Expo docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.** Expo APIs change between versions and the current codebase targets Expo 54.

## Commands

```bash
npm start          # Start Expo dev server (scan QR with Expo Go)
npm run android    # Start and open on Android emulator
npm run ios        # Start and open on iOS simulator
npm run web        # Start and open in browser
```

No test runner or linter is configured yet.

## Architecture

Estamos desarrollando una aplicación móvil de notas híbrida (locales + compartidas) orientada a la simplicidad, con foco en el uso en parejas o pequeños grupos, bajo un enfoque "Offline-First" y privacidad desde el diseño.

#### 1. Especificaciones Técnicas y Stack:
- **Framework:** React Native con Expo (SDK compatible con Expo Go, TypeScript).
- **Entorno de ejecucion:** Linux (Ubuntu).
- **Navegación / UI:** Sistema basado en componentes/etiquetas nativas (`<View>`, `<Text>`, `<TextInput>`, `<TouchableOpacity>`, `<FlatList>`).
- **Librería de Iconos:** `@expo/vector-icons` (Familia `Feather`).
- **Persistencia Local:** `@react-native-async-storage/async-storage` (Persistencia completa en disco de notas locales).
- **Backend / Sincronización:** Supabase (PostgreSQL, Row Level Security - RLS, Storage). Cliente en `lib/supabase.ts`; `supabase` es `null` si no hay `.env` configurado (las notas locales deben poder usarse sin Supabase). Credenciales en `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (clave `sb_publishable_...`, nunca `sb_secret_...`), ver `.env.example`.
- **Cifrado:** `tweetnacl` (cifrado simétrico autenticado, pura JS) + `expo-crypto` (aleatoriedad segura) + `base64-arraybuffer`. Ver detalle más abajo.
- **Utilidades activas:** `expo-clipboard` para copiar PINs de acceso.

#### 2. Diseño e Interfaz (UI/UX):
- **Estilo:** Tema oscuro minimalista (Fondo `#0f0f0f`, tarjetas `#181818`, acentos en naranja `#ff6b00`, verde código `#00ff88` y tonos neutros).
- **Pantalla Principal:** Grid/Masonry de 2 columnas estilo Xiaomi (MIUI/HyperOS Notes) que renderiza tarjetas con título, previsualización de contenido, fecha e indicador de tipo de nota (`Local` con candado / `PIN` compartida).
- **Acciones:** Botón flotante (FAB) naranja para crear notas y Modal deslizante para editar/leer notas existentes con opción de borrado.

#### 3. Arquitectura de Datos y Funcionalidades Clave:
- **Modelo de Nota:** `id`, `titulo`, `contenido` (HTML enriquecido: negrita, cursiva, tachado, código, listas, tareas, imágenes), `esCompartida`, `pinAcceso` (opcional), `fecha`.
- **Notas Locales:** Viven exclusivamente en el almacenamiento interno del dispositivo mediante `AsyncStorage` (nunca tocan la nube).
- **Notas Compartidas (Sincronización):** Sistema de acceso mediante código de unión/PIN alfanumérico (NanoID de 16 caracteres, agrupado en bloques tipo `X7K9-P2M4-Q8RT-3WYL` para legibilidad) con botón de copiado al portapapeles. El PIN es también la base del cifrado (ver más abajo); por eso pasó de 6 a 16 caracteres frente al diseño inicial.
  - **Unirse a una nota compartida:** botón dedicado que abre un formulario donde el usuario introduce el PIN/código de la nota y su nombre de usuario para unirse.
  - **Rol del creador (owner):** puede ver la lista de participantes unidos a la nota, revocar/eliminar el acceso de cualquiera de ellos, y asignar el permiso de escritura de forma individual, participante por participante.
  - **Modelo de permisos:** todo el que se une a una nota compartida tiene lectura por defecto; el permiso de escritura no es automático, lo concede el creador uno por uno.
  - *(Pendiente de implementar: hoy `pinAcceso` es un valor fijo de ejemplo de 6 caracteres (`K9F-X2`) sin backend de unión, sin lista de participantes ni control de permisos real en Supabase.)*
- **Imágenes — estrategia de almacenamiento (según si la nota es local o compartida):**
  - **Notas locales:** la imagen se embebe como `data:` URI en base64 directamente dentro del HTML de `contenido` (nunca sale del dispositivo, sin coste de red, sin cifrar — no hace falta). Así funciona ya hoy.
  - **Notas compartidas:** la imagen se cifra en el dispositivo (ver cifrado E2E más abajo) y el resultado cifrado se sube a **Supabase Storage** (no a la base de datos); solo la URL resultante se guarda dentro del HTML de `contenido` (`<img src="...">`). Supabase almacena y sirve bytes cifrados, nunca la imagen en claro.
  - **Motivo (Storage vs BBDD):** un base64 en Postgres infla el tamaño de la fila (cuenta contra el límite de tamaño de BBDD) y se transfiere entero como egress normal cada vez que se lee la nota; Storage sirve el archivo por CDN, no ocupa la BBDD, y su tráfico cuenta como "cached egress" (cuota más holgada en el plan free).
  - *(Pendiente de implementar: hoy todas las notas —incluidas las que tienen `esCompartida: true`— usan el flujo de base64 embebido sin cifrar; aún no existe subida a Supabase Storage ni cifrado.)*
- **Cifrado extremo a extremo (E2EE) para notas compartidas:** Supabase no debe ver nunca contenido en claro — ni el texto de la nota ni las imágenes. Se cifra en el dispositivo antes de subir, se descifra en el dispositivo al recibir.
  - **Qué se cifra:** el HTML de `contenido` (incluye el título) y cada imagen, antes de que salgan del dispositivo.
  - **Origen de la clave:** se deriva del propio `pinAcceso` mediante una función de derivación de claves (KDF) con coste (muchas iteraciones), calculada en el dispositivo. La clave nunca se genera en Supabase ni se le envía; cualquiera que conozca el PIN puede derivarla localmente.
  - **Por qué el PIN es de 16 caracteres:** uno corto (6 caracteres, ~30 bits de entropía) sería vulnerable a fuerza bruta offline sobre el contenido cifrado. Con 16 caracteres (~80 bits) más el coste de la KDF, se vuelve computacionalmente inviable. La incomodidad de un PIN más largo es irrelevante porque ya se comparte con el botón de copiar, no escribiéndolo a mano.
  - **Librerías (deben mantener compatibilidad con Expo Go, sin módulos nativos):** `expo-crypto` (ya forma parte del SDK de Expo) para bytes aleatorios seguros, combinado con `tweetnacl` (cifrado simétrico autenticado, pura JS, sin dependencias nativas) para cifrar/descifrar. Se descartan librerías de cifrado JS poco usadas o no auditadas para este propósito, por tratarse de código de seguridad.
  - **Umbral de seguridad aceptado conscientemente:** protege frente a acceso casual a la BBDD/Storage (un admin, alguien con la URL de una imagen, una brecha de datos de Supabase); no protege frente a un atacante muy decidido con mucha capacidad de cómputo dispuesto a atacar el PIN por fuerza bruta. Se acepta este umbral; no se usa un secreto independiente del PIN.
  - *(Pendiente de implementar: hoy ni el contenido ni las imágenes de las notas compartidas se cifran.)*





