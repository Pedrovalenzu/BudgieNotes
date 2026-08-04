-- Ejecutar en el SQL Editor del proyecto de Supabase, después de storage-setup.sql.
-- Esquema de notas compartidas: sin cuentas de usuario (Auth anónima), sin contenido en claro
-- (contenido_cifrado y sal_cifrado son opacos para Supabase, ver lib/cifrado.ts).

create extension if not exists pgcrypto;

create table if not exists public.notas_compartidas (
  id uuid primary key default gen_random_uuid(),
  creador_id uuid not null references auth.users(id) on delete cascade,
  pin_hash text not null unique,       -- sha-256(pin), NUNCA el pin ni la clave de cifrado
  sal_cifrado text not null,           -- aleatoria, no secreta (hace falta para derivar la clave)
  contenido_cifrado text not null,     -- salida de cifrarContenidoNota() — título, texto e imágenes
  expira_en timestamptz,
  editado_por uuid references auth.users(id) on delete set null,
  editado_en timestamptz,
  creado_en timestamptz not null default now()
);

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

-- notas_compartidas: lectura para el creador y para quien ya se ha unido; escritura del contenido
-- para el creador o para quien tenga puede_escribir=true; borrar la nota, solo el creador.
create policy "Lectura: creador o participante"
on public.notas_compartidas for select
to authenticated
using (
  creador_id = auth.uid()
  or exists (
    select 1 from public.participantes_nota p
    where p.nota_id = notas_compartidas.id and p.usuario_id = auth.uid()
  )
);

create policy "Creación: el creador se registra a sí mismo"
on public.notas_compartidas for insert
to authenticated
with check (creador_id = auth.uid());

create policy "Edición: creador o participante con permiso de escritura"
on public.notas_compartidas for update
to authenticated
using (
  creador_id = auth.uid()
  or exists (
    select 1 from public.participantes_nota p
    where p.nota_id = notas_compartidas.id and p.usuario_id = auth.uid() and p.puede_escribir = true
  )
);

create policy "Borrado: solo el creador"
on public.notas_compartidas for delete
to authenticated
using (creador_id = auth.uid());

-- participantes_nota: el creador ve y gestiona a todos los de su nota; un participante se ve a sí
-- mismo y al resto de participantes de las notas en las que está, puede unirse él mismo, y puede
-- salir por su cuenta (borrar su propia fila) aunque no sea el creador.
create policy "Lectura: creador de la nota o participante de la nota"
on public.participantes_nota for select
to authenticated
using (
  usuario_id = auth.uid()
  or exists (
    select 1 from public.notas_compartidas n
    where n.id = participantes_nota.nota_id and n.creador_id = auth.uid()
  )
  or exists (
    select 1 from public.participantes_nota p2
    where p2.nota_id = participantes_nota.nota_id and p2.usuario_id = auth.uid()
  )
);

create policy "Unirse: cada uno se da de alta a sí mismo"
on public.participantes_nota for insert
to authenticated
with check (usuario_id = auth.uid());

create policy "Permisos: solo el creador de la nota los cambia"
on public.participantes_nota for update
to authenticated
using (
  exists (
    select 1 from public.notas_compartidas n
    where n.id = participantes_nota.nota_id and n.creador_id = auth.uid()
  )
);

create policy "Salir o expulsar: el propio participante o el creador de la nota"
on public.participantes_nota for delete
to authenticated
using (
  usuario_id = auth.uid()
  or exists (
    select 1 from public.notas_compartidas n
    where n.id = participantes_nota.nota_id and n.creador_id = auth.uid()
  )
);
