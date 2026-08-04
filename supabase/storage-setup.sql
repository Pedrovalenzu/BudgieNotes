-- Ejecutar en el SQL Editor del proyecto de Supabase.
-- Crea el bucket público para las imágenes de notas compartidas y los permisos
-- mínimos necesarios: como la app no usa Supabase Auth (el acceso a una nota
-- compartida es por PIN, no por cuenta), las políticas se conceden al rol "anon".

insert into storage.buckets (id, name, public)
values ('notas-compartidas', 'notas-compartidas', true)
on conflict (id) do nothing;

create policy "Lectura pública de imágenes de notas compartidas"
on storage.objects for select
to anon
using (bucket_id = 'notas-compartidas');

create policy "Subida de imágenes de notas compartidas"
on storage.objects for insert
to anon
with check (bucket_id = 'notas-compartidas');
