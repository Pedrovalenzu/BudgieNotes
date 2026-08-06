-- Ejecutar en el SQL Editor del proyecto de Supabase, después de storage-setup.sql.
-- Esquema de notas compartidas: sin cuentas de usuario (Auth anónima), sin contenido en claro
-- (contenido_cifrado y sal_cifrado son opacos para Supabase, ver lib/cifrado.ts).

create extension if not exists pgcrypto;

create table if not exists public.notas_compartidas (
  id uuid primary key default gen_random_uuid(),
  creador_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text not null unique,       -- sha-256(pin), NUNCA el pin ni la clave de cifrado
  sal_cifrado text not null,           -- aleatoria, no secreta (hace falta para derivar la clave)
  titulo_cifrado text not null,        -- cifrado aparte del contenido (cifrarTexto, sin imágenes)
  contenido_cifrado text not null,     -- salida de cifrarContenidoNota() — texto enriquecido + imágenes
  expira_en timestamptz,
  editado_por uuid references auth.users(id) on delete set null,
  editado_en timestamptz,
  creado_en timestamptz not null default now()
);

-- Por si ya habías ejecutado una versión anterior de este script sin titulo_cifrado
alter table public.notas_compartidas add column if not exists titulo_cifrado text;

create table if not exists public.participantes_nota (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_compartidas(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nombre_usuario text not null,
  puede_escribir boolean not null default false,
  unido_en timestamptz not null default now(),
  unique (nota_id, usuario_id)
);

alter table public.notas_compartidas enable row level security;
alter table public.participantes_nota enable row level security;

-- Búsqueda de una nota por su PIN (hasheado) para poder unirse. Se hace con una función en vez de
-- un SELECT normal para no tener que abrir una política de "cualquiera puede leer cualquier fila":
-- esta función solo devuelve lo mínimo necesario para unirse (id y sal), nunca el contenido cifrado.
create or replace function public.buscar_nota_por_pin(p_pin_hash text)
returns table (id uuid, sal_cifrado text)
language sql
security definer
set search_path = public
as $$
  select n.id, n.sal_cifrado
  from notas_compartidas n
  where n.pin_hash = p_pin_hash;
$$;

grant execute on function public.buscar_nota_por_pin(text) to authenticated;

-- Funciones auxiliares SECURITY DEFINER para romper la recursión entre las políticas de las dos
-- tablas: notas_compartidas necesita mirar participantes_nota (¿soy participante?) y
-- participantes_nota necesita mirar notas_compartidas (¿soy el creador?). Con un EXISTS normal,
-- leer una dispara el RLS de la otra, que vuelve a disparar el de la primera → "infinite recursion
-- detected in policy". Al ser SECURITY DEFINER, la consulta de dentro de la función no vuelve a
-- pasar por RLS, así que corta el ciclo.
create or replace function public.es_creador_de_nota(p_nota_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from notas_compartidas where id = p_nota_id and creador_id = auth.uid()
  );
$$;

create or replace function public.es_participante_de_nota(p_nota_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from participantes_nota where nota_id = p_nota_id and usuario_id = auth.uid()
  );
$$;

create or replace function public.puede_escribir_en_nota(p_nota_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from participantes_nota
    where nota_id = p_nota_id and usuario_id = auth.uid() and puede_escribir = true
  );
$$;

grant execute on function public.es_creador_de_nota(uuid) to authenticated;
grant execute on function public.es_participante_de_nota(uuid) to authenticated;
grant execute on function public.puede_escribir_en_nota(uuid) to authenticated;

-- CREATE POLICY no admite "IF NOT EXISTS" (a diferencia de CREATE TABLE), así que para que este
-- script se pueda volver a ejecutar entero sin errores cada vez que cambie algo, se borra la
-- política justo antes de crearla.

-- notas_compartidas: lectura para el creador y para quien ya se ha unido; escritura del contenido
-- para el creador o para quien tenga puede_escribir=true; borrar la nota, solo el creador.
drop policy if exists "Lectura: creador o participante" on public.notas_compartidas;
create policy "Lectura: creador o participante"
on public.notas_compartidas for select
to authenticated
using (
  creador_id = auth.uid()
  or public.es_participante_de_nota(id)
);

drop policy if exists "Creación: el creador se registra a sí mismo" on public.notas_compartidas;
create policy "Creación: el creador se registra a sí mismo"
on public.notas_compartidas for insert
to authenticated
with check (creador_id = auth.uid());

drop policy if exists "Edición: creador o participante con permiso de escritura" on public.notas_compartidas;
create policy "Edición: creador o participante con permiso de escritura"
on public.notas_compartidas for update
to authenticated
using (
  creador_id = auth.uid()
  or public.puede_escribir_en_nota(id)
);

drop policy if exists "Borrado: solo el creador" on public.notas_compartidas;
create policy "Borrado: solo el creador"
on public.notas_compartidas for delete
to authenticated
using (creador_id = auth.uid());

-- participantes_nota: el creador ve y gestiona a todos los de su nota; un participante se ve a sí
-- mismo y al resto de participantes de las notas en las que está, puede unirse él mismo, y puede
-- salir por su cuenta (borrar su propia fila) aunque no sea el creador.
drop policy if exists "Lectura: creador de la nota o participante de la nota" on public.participantes_nota;
create policy "Lectura: creador de la nota o participante de la nota"
on public.participantes_nota for select
to authenticated
using (
  usuario_id = auth.uid()
  or public.es_creador_de_nota(nota_id)
  or public.es_participante_de_nota(nota_id)
);

drop policy if exists "Unirse: cada uno se da de alta a sí mismo" on public.participantes_nota;
create policy "Unirse: cada uno se da de alta a sí mismo"
on public.participantes_nota for insert
to authenticated
with check (usuario_id = auth.uid());

drop policy if exists "Permisos: solo el creador de la nota los cambia" on public.participantes_nota;
create policy "Permisos: solo el creador de la nota los cambia"
on public.participantes_nota for update
to authenticated
using (public.es_creador_de_nota(nota_id));

drop policy if exists "Salir o expulsar: el propio participante o el creador de la nota" on public.participantes_nota;
create policy "Salir o expulsar: el propio participante o el creador de la nota"
on public.participantes_nota for delete
to authenticated
using (
  usuario_id = auth.uid()
  or public.es_creador_de_nota(nota_id)
);
