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
- **Estilo — dos temas, elegibles en caliente:** Acentos en naranja `#ff6b00` y verde código `#00ff88` iguales en ambos; solo cambia la escala de grises (fondo/superficie/bordes/texto), con el mismo esquema de "claridad" en los dos. Sistema en `lib/tema.ts` (los tokens: `fondo`, `superficie`, `borde`, `bordeFuerte`, `textoTerciario`, `textoSecundario`, `textoSecundarioAlt`, `textoIcono`) + `lib/TemaContext.tsx` (`TemaProvider`/`useTema()`, persiste la elección en `AsyncStorage`). `App.tsx` y los modales en `components/` no llevan colores sueltos: cada uno calcula sus estilos con `crearEstilos(tema)` (memoizado) en vez de un `StyleSheet.create` fijo; el CSS del editor (`crearCssEditor`) también depende del tema.
  - **Navy (por defecto):** `#0F172A` fondo, `#182033` superficie, `#222A3D`/`#333B4E` bordes, `#444C5F`→`#8890A3` texto/iconos según nivel.
  - **Oscuro (alternativa, negro puro — el tema original de la app):** `#0f0f0f` fondo, `#181818` superficie, `#222222`/`#333333` bordes, `#444444`→`#888888` texto/iconos. Se activa con el botón "Oscuro" (icono luna) en la barra inferior.
  - Texto claro (títulos, contenido del editor) sin teñir en ningún tema: `#ccc`, `#ececec`, `#fff`.
- **Pantalla Principal:** Grid/Masonry de 2 columnas estilo Xiaomi (MIUI/HyperOS Notes) que renderiza tarjetas con título, previsualización de contenido, fecha e indicador de tipo de nota (`Local` con candado / `PIN` compartida).
- **Acciones:** Botón flotante (FAB) naranja para crear notas y Modal deslizante para editar/leer notas existentes con opción de borrado.

#### 3. Arquitectura de Datos y Funcionalidades Clave:
- **Modelo de Nota:** `id`, `titulo`, `contenido` (HTML enriquecido: negrita, cursiva, tachado, código, listas, tareas, imágenes), `esCompartida`, `pinAcceso` (opcional), `salCifrado` (opcional, ver cifrado E2E más abajo), `fecha`.
- **Notas Locales:** Viven exclusivamente en el almacenamiento interno del dispositivo mediante `AsyncStorage` (nunca tocan la nube).
  - **Cerrojo anti-pérdida de datos:** todo el array de notas (locales y compartidas) se guarda como un único JSON bajo una sola clave de `AsyncStorage`, así que cualquier escritura sobrescribe el conjunto entero. Hubo un caso real de pérdida total de notas sin reinicio del teléfono, causado por esto: `guardarNota`/`notaUnida`/etc. construían la lista nueva a partir del estado `notas` en memoria, y si el usuario creaba una nota antes de que `cargarNotasGuardadas()` terminara de leer el almacenamiento (carrera muy fácil de dar nada más abrir la app), `notas` seguía siendo `[]` y esa escritura borraba todo lo anterior. Arreglado con un cerrojo síncrono (`useRef`, no `useState`, precisamente para no depender del timing de un re-render): `guardarEnStorage()` en `App.tsx` rechaza cualquier escritura hasta que la carga inicial haya terminado con éxito (`notasCargadasDeVerdad.current`), y si la lectura falla (JSON corrupto, error de E/O) la app muestra una pantalla bloqueante de "Reintentar" en vez de seguir con la lista vacía en memoria — así nunca se sobrescribe algo que no se ha podido confirmar que se leyó bien. Cualquier función nueva que guarde notas debe pasar siempre por `guardarEnStorage()`, nunca escribir en `AsyncStorage` por su cuenta.
- **Notas Compartidas (Sincronización):** Sistema de acceso mediante código de unión/PIN alfanumérico (NanoID de 16 caracteres, agrupado en bloques tipo `X7K9-P2M4-Q8RT-3WYL` para legibilidad) con botón de copiado al portapapeles. El PIN es también la base del cifrado (ver más abajo); por eso pasó de 6 a 16 caracteres frente al diseño inicial. Generación real implementada en `lib/pin.ts` (`generarPin()`): al activar "Compartida" en el editor se genera un PIN y una sal nuevos (`lib/cifrado.ts`, `generarSalBase64()`), se muestran/copian de verdad y viajan con la nota al guardar.
  - **Unirse a una nota compartida:** botón dedicado que abre un formulario donde el usuario introduce el PIN/código de la nota y su nombre de usuario para unirse.
  - **Rol del creador (owner):** puede ver la lista de participantes unidos a la nota, revocar/eliminar el acceso de cualquiera de ellos, y asignar el permiso de escritura de forma individual, participante por participante.
  - **Modelo de permisos:** todo el que se une a una nota compartida tiene lectura por defecto; el permiso de escritura no es automático, lo concede el creador uno por uno.
  - *(Pendiente de implementar: no existe backend de unión en Supabase, ni tabla de notas compartidas, ni lista de participantes, ni control de permisos real. El PIN/sal ya se generan de verdad, pero hoy la nota solo se guarda en `AsyncStorage` local — nada viaja todavía a Supabase.)*
- **Imágenes — estrategia de almacenamiento (según si la nota es local o compartida):**
  - **Notas locales:** la imagen se embebe como `data:` URI en base64 directamente dentro del HTML de `contenido` (nunca sale del dispositivo, sin coste de red, sin cifrar — no hace falta). Así funciona ya hoy, sin cambios.
  - **Notas compartidas:** mientras se edita, la imagen también se embebe en base64 en el HTML (mismo flujo que local, `seleccionarImagen()` no distingue). La conversión a "cifrada en Storage" ocurre en un solo paso, al preparar la nota para Supabase: ver `cifrarContenidoNota` más abajo.
  - **Motivo (Storage vs BBDD):** un base64 en Postgres infla el tamaño de la fila (cuenta contra el límite de tamaño de BBDD) y se transfiere entero como egress normal cada vez que se lee la nota; Storage sirve el archivo por CDN, no ocupa la BBDD, y su tráfico cuenta como "cached egress" (cuota más holgada en el plan free).
  - *(Pendiente de implementar: `cifrarContenidoNota`/`descifrarContenidoNota` (`lib/contenidoCompartido.ts`) ya hacen la subida cifrada a Storage y la lectura inversa, y están probadas, pero no las llama nadie todavía — falta el guardado/lectura real contra Supabase.)*
- **Cifrado extremo a extremo (E2EE) para notas compartidas — implementado, no conectado aún:** Supabase no debe ver nunca contenido en claro — ni el texto de la nota ni las imágenes. Se cifra en el dispositivo antes de subir, se descifra en el dispositivo al recibir.
  - **Qué se cifra:** el HTML de `contenido` (incluye el título) y cada imagen, antes de que salgan del dispositivo.
  - **Cómo se deriva la clave (dos pasos, no confundir):**
    1. `derivarClaveDesdePin(pin, sal)` (`lib/cifrado.ts`) combina el PIN (el secreto real, de 16 caracteres) con la sal (aleatoria pero **no secreta**, guardada en claro en `salCifrado` junto al PIN) mediante SHA-512 repetido 20.000 veces (`nacl.hash`, sin HMAC/PBKDF2 "de libro" por no depender de más librerías). El resultado es una clave de 32 bytes. Esta función no cifra nada, solo produce la clave.
    2. Esa clave (no el PIN directamente) es la que cifra/descifra de verdad, junto con un nonce aleatorio distinto en cada operación (`cifrarBytes`/`descifrarBytes` sobre `nacl.secretbox`), para que cifrar el mismo contenido dos veces dé resultados distintos.
    - La sal existe para que un atacante no pueda precalcular una única tabla de "PIN → clave" reutilizable contra todas las notas de todos los usuarios: cada nota tiene su propia sal, así que ese precálculo hay que rehacerlo nota por nota.
    - La clave nunca se genera en Supabase ni se le envía; cualquiera que conozca el PIN puede derivarla localmente.
  - **Por qué el PIN es de 16 caracteres:** uno corto (6 caracteres, ~30 bits de entropía) sería vulnerable a fuerza bruta offline sobre el contenido cifrado. Con 16 caracteres (~80 bits) más el coste de la KDF (20.000 iteraciones por cada PIN que se quiera probar), se vuelve computacionalmente inviable. La incomodidad de un PIN más largo es irrelevante porque ya se comparte con el botón de copiar, no escribiéndolo a mano.
  - **Rendimiento de la KDF:** ~315 ms para las 20.000 iteraciones, medido en Node en la máquina de desarrollo (no en un móvil real) — ver `ITERACIONES_KDF` en `lib/cifrado.ts` si hace falta ajustarlo tras probar en dispositivo.
  - **Librerías (deben mantener compatibilidad con Expo Go, sin módulos nativos):** `expo-crypto` (ya forma parte del SDK de Expo) para bytes aleatorios seguros, combinado con `tweetnacl` (cifrado simétrico autenticado, pura JS, sin dependencias nativas) para cifrar/descifrar. Se descartan librerías de cifrado JS poco usadas o no auditadas para este propósito, por tratarse de código de seguridad.
  - **Umbral de seguridad aceptado conscientemente:** protege frente a acceso casual a la BBDD/Storage (un admin, alguien con la URL de una imagen, una brecha de datos de Supabase); no protege frente a un atacante muy decidido con mucha capacidad de cómputo dispuesto a atacar el PIN por fuerza bruta. Se acepta este umbral; no se usa un secreto independiente del PIN.
  - **Archivos:** `lib/cifrado.ts` (primitivas: derivar clave, cifrar/descifrar texto y bytes), `lib/pin.ts` (`generarPin`), `lib/storageImagenes.ts` (sube/baja bytes ya cifrados a/desde el bucket `notas-compartidas`, sin saber qué contienen), `lib/contenidoCompartido.ts` (`cifrarContenidoNota`/`descifrarContenidoNota`, la pieza que une HTML + imágenes + cifrado + Storage en un solo paso). Bucket y políticas RLS: `supabase/storage-setup.sql`.
  - *(Pendiente de implementar: el núcleo de cifrado está hecho y probado —incluida una ronda de tests en `node` cubriendo texto con tildes/emoji, binarios, PIN incorrecto y no-reutilización de nonce—, pero `guardarNota`/`cargarNotasGuardadas` siguen sin llamarlo: no hay todavía guardado/lectura real de notas compartidas contra Supabase.)*
- **Widget de pantalla de inicio + notificaciones push — solo conversado, pendiente de implementar (ambas cosas, en este orden de dependencia):**
  - **Objetivo:** poder ver el estado real de una nota compartida (p. ej. que otra persona la ha modificado) sin necesidad de abrir la app, idealmente casi al instante.
  - **Widget (Android):** vía `react-native-android-widget` (u otro enfoque nativo equivalente) — requiere código nativo real, así que solo funcionará en builds locales/EAS (`expo prebuild`), nunca en Expo Go. iOS (WidgetKit) queda descartado por ahora: hace falta Xcode/macOS y este entorno de desarrollo es Linux/Ubuntu sin Mac disponible.
  - **Notificaciones push:** son el mecanismo necesario para el "casi al instante" — Android limita el refresco automático en segundo plano de un widget a un mínimo de ~30 minutos sin un disparador externo, así que sin push el widget solo se actualizaría de forma periódica y lenta, no en el momento en que alguien más edita la nota. La app tendría que recibir la notificación push al guardar una nota compartida y usarla para forzar el refresco del widget.
  - **Orden lógico:** primero habría que tener el guardado/sync de notas compartidas terminado y estable (ver puntos "Pendiente de implementar" de más arriba), después las notificaciones push (servidor/trigger que avise de cada guardado), y por último el widget (que consume ese aviso para refrescarse). No se ha empezado ninguna de las tres.




