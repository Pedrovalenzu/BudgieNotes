-- Ejecutar en el SQL Editor del proyecto de Supabase. Seguro de volver a ejecutar (usa
-- ON CONFLICT / DROP POLICY IF EXISTS), por si hay que repetirlo tras un cambio.
--
-- Crea el bucket público para las imágenes de notas compartidas y los permisos mínimos
-- necesarios. La app no pide login, pero sí usa sesión anónima de Supabase (signInAnonymously,
-- ver lib/auth.ts) antes de subir nada — con sesión iniciada (aunque sea anónima), el rol de
-- Postgres para RLS es "authenticated", no "anon" (ese es solo para peticiones sin ninguna
-- sesión). Por eso las políticas van sobre "authenticated".

insert into storage.buckets (id, name, public)
values ('notas-compartidas', 'notas-compartidas', true)
on conflict (id) do nothing;

drop policy if exists "Lectura pública de imágenes de notas compartidas" on storage.objects;
create policy "Lectura pública de imágenes de notas compartidas"
on storage.objects for select
to authenticated
using (bucket_id = 'notas-compartidas');

drop policy if exists "Subida de imágenes de notas compartidas" on storage.objects;
create policy "Subida de imágenes de notas compartidas"
on storage.objects for insert
to authenticated
with check (bucket_id = 'notas-compartidas');
