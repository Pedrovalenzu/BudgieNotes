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
- **Backend / Sincronización:** Supabase (PostgreSQL, Row Level Security - RLS).
- **Utilidades activas:** `expo-clipboard` para copiar PINs de acceso.

#### 2. Diseño e Interfaz (UI/UX):
- **Estilo:** Tema oscuro minimalista (Fondo `#0f0f0f`, tarjetas `#181818`, acentos en naranja `#ff6b00`, verde código `#00ff88` y tonos neutros).
- **Pantalla Principal:** Grid/Masonry de 2 columnas estilo Xiaomi (MIUI/HyperOS Notes) que renderiza tarjetas con título, previsualización de contenido, fecha e indicador de tipo de nota (`Local` con candado / `PIN` compartida).
- **Acciones:** Botón flotante (FAB) naranja para crear notas y Modal deslizante para editar/leer notas existentes con opción de borrado.

#### 3. Arquitectura de Datos y Funcionalidades Clave:
- **Modelo de Nota:** `id`, `titulo`, `contenido`, `esCompartida`, `pinAcceso` (opcional), `fecha`.
- **Notas Locales:** Viven exclusivamente en el almacenamiento interno del dispositivo mediante `AsyncStorage` (nunca tocan la nube).
- **Notas Compartidas (Sincronización):** Sistema de acceso mediante código de unión/PIN alfanumérico corto (NanoID tipo `X7K-9P`) con botón de copiado al portapapeles.
- **Filosofía de Cifrado / Seguridad:** Cifrado extremo a extremo, aislamiento de datos en nube vía Supabase RLS y almacenamiento seguro en dispositivo.





