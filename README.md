<img width="1218" height="473" alt="image" src="https://github.com/user-attachments/assets/fb748f74-88da-40b6-8d84-04ff97749776" />


# Budgie Notes

A self-hosted hybrid notes app (local + shared) built for couples and small groups. It works offline and protects its users' privacy: when a note is shared, it is encrypted on the device before it ever leaves it.

<p align="center">
  <img height="560" alt="Main screen" src="https://github.com/user-attachments/assets/daf63095-70b5-4bc0-9712-f69823276c62" />
  &nbsp;&nbsp;
  <img height="560" alt="Usage demo" src="https://github.com/user-attachments/assets/4fc0e619-5d08-4bd5-aed7-8780f4d26252" />

  
</p>

## Features

- **Local notes:** stored only on the device and never touch the cloud. The app is fully usable without setting up any backend.
- **Shared notes:** synced through your own Supabase instance. Joining a note only takes a 16-character access code (`X7K9-P2M4-Q8RT-3WYL`) that can be copied with one tap.
- **End-to-end encryption:** the title, content and images of shared notes are encrypted on the device (`tweetnacl`). Supabase only stores encrypted data; the key is derived from the access code and is never sent to the server.
- **Per-participant permissions:** the note's creator can see who has joined, remove anyone, and grant write access person by person. By default, everyone who joins can only read.
- **Conflict detection:** if two people edit the same note at the same time, the app detects it and lets you choose which version to keep.
- **Rich text editor:** bold, italic, strikethrough, code, lists, task lists and images.
- **Autosave:** no need to hit save.
- **Temporary notes:** they self-destruct when they reach their expiration date.
- **Favorites, filters and search:** Shared / Local / Temporary / Favorites.
- **Two themes:** Navy (default) and Dark (pure black), switchable on the fly.
- **No accounts:** no sign-up or login; each device uses an anonymous Supabase session.

## Stack

- [Expo](https://docs.expo.dev/versions/v54.0.0/) SDK 54 + React Native + TypeScript
- [`@10play/tentap-editor`](https://github.com/10play/10tap-editor) (Tiptap) for the editor
- `AsyncStorage` + `expo-file-system` for local persistence
- [Supabase](https://supabase.com) (PostgreSQL with RLS + Storage) for shared notes
- `tweetnacl` + `expo-crypto` for encryption

## Getting started

### Requirements

- Node.js and npm
- The [Expo Go](https://expo.dev/go) app on your phone, or an Android/iOS emulator

### Installation

```bash
git clone https://github.com/Pedrovalenzu/BudgieNotes.git
cd BudgieNotes
npm install
npm start
```

Scan the QR code with Expo Go. That's all you need to use local notes.

Other commands:

```bash
npm run android    # Local native Android build (doesn't use Expo Go)
npm run ios        # Local native iOS build (requires macOS)
npm run web        # Open in the browser
npx tsc --noEmit   # Type-check
```

### Shared notes (optional): setting up Supabase

Shared notes need your own Supabase project (the free plan is enough).

1. Create a project at [supabase.com](https://supabase.com).
2. Under **Authentication → Sign In / Providers**, enable **Allow anonymous sign-ins**.
3. In the **SQL Editor**, run in this order:
   1. [`supabase/storage-setup.sql`](supabase/storage-setup.sql): creates the image bucket and its policies.
   2. [`supabase/notas-compartidas-setup.sql`](supabase/notas-compartidas-setup.sql): creates the tables, RLS policies and functions.
4. Copy `.env.example` to `.env` and fill it in with the credentials from **Project Settings → API**:

   ```bash
   cp .env.example .env
   ```

   > Always use the **publishable/anon** key, never the `sb_secret_...` one: this value ends up bundled inside the app.

5. Restart `npm start` so the variables are loaded.

## Usage

- **Create a note:** tap the orange `+` button.
- **Share it:** in the editor, turn on "Compartida" (Shared). An access code is generated; copy it and send it to the other person.
- **Join a note:** tap the join button, paste the code and enter your name.
- **Manage participants:** if you're the creator, open the participant list from the note to grant write access or remove someone.

## Privacy and security

- Local notes never leave the device.
- For shared notes, the server only sees encrypted data. To look up a note by its code, a SHA-256 hash of the code is stored, which can't be used to rebuild the encryption key.
- The key is derived from the access code (16 characters, ~80 bits) with a random per-note salt and 20,000 iterations of SHA-512.
- **Accepted limitation:** the encryption protects against casual access to the database or Storage (an admin, a data leak, someone with an image URL). Anyone who has the access code can read the note, so only share it with people you trust.


## Roadmap

- [ ] Push notifications when someone edits a shared note
- [ ] Android home screen widget
