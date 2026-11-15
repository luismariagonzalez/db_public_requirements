-- ════════════════════════════════════════════════════════════════════════════
--  0003 · jerarquía de categorías: audiencia → dominio → categoría de software
--
--  · tipo 'audience'          b2b, b2c, b2b2c, b2g, internal, developer
--  · tipo 'domain'            agrupa categorías por función o sector (marketing,
--                             finanzas, sanidad…)
--  · tipo 'software_category' las categorías de software de Capterra (≈1000)
--
--  Una categoría de software cuelga de UN dominio (`dominio`) y puede servir a
--  VARIAS audiencias (`audiencias`). Los requisitos siguen colgando de las
--  categorías «hoja»; pedir una audiencia o un dominio se expande a sus hojas en
--  la API (lib/categorias.mjs), sin tocar las funciones de búsqueda.
-- ════════════════════════════════════════════════════════════════════════════

alter table db_public_requirements.categoria
  drop constraint categoria_tipo_check;
alter table db_public_requirements.categoria
  add constraint categoria_tipo_check check (tipo in
    ('app_type', 'screen_type', 'cross_cutting', 'audience', 'domain', 'software_category'));

alter table db_public_requirements.categoria
  add column dominio text references db_public_requirements.categoria (slug) on delete set null,
  add column audiencias text[] not null default '{}' check (cardinality(audiencias) <= 6);
create index on db_public_requirements.categoria (dominio);
create index on db_public_requirements.categoria using gin (audiencias);

-- La firma cambia (dominio y audiencias): se retira la anterior para que una
-- llamada de 5 argumentos no sea ambigua.
drop function public.db_public_requirements_srv_upsert_categoria(text, text, text, text, int);

create function public.db_public_requirements_srv_upsert_categoria(
  p_slug text, p_tipo text, p_nombre text, p_descripcion text, p_orden int,
  p_dominio text default null, p_audiencias text[] default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare a text;
begin
  if p_dominio is not null and not exists (
       select 1 from db_public_requirements.categoria where slug = p_dominio and tipo = 'domain') then
    raise exception 'el dominio % no existe', p_dominio;
  end if;
  foreach a in array coalesce(p_audiencias, '{}') loop
    if not exists (select 1 from db_public_requirements.categoria where slug = a and tipo = 'audience') then
      raise exception 'la audiencia % no existe', a;
    end if;
  end loop;

  insert into db_public_requirements.categoria (slug, tipo, nombre, descripcion, orden, dominio, audiencias)
  values (p_slug, p_tipo, p_nombre, coalesce(p_descripcion, ''), coalesce(p_orden, 100),
          p_dominio, coalesce(p_audiencias, '{}'))
  on conflict (slug) do update
    set tipo = excluded.tipo, nombre = excluded.nombre, descripcion = excluded.descripcion,
        orden = excluded.orden, dominio = excluded.dominio, audiencias = excluded.audiencias;
end;
$$;

create or replace function public.db_public_requirements_srv_categorias()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', c.slug, 'type', c.tipo, 'name', c.nombre, 'description', c.descripcion,
           'domain', c.dominio, 'audiences', to_jsonb(c.audiencias),
           'requirements', (select count(*) from db_public_requirements.requisito_categoria rc
                              join db_public_requirements.requisito r on r.id = rc.requisito_id
                             where rc.categoria_slug = c.slug and r.estado = 'published'))
         order by c.tipo, c.orden, c.nombre), '[]'::jsonb)
  from db_public_requirements.categoria c
$$;

-- permisos (idempotente): la función nueva nace con EXECUTE para PUBLIC
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and starts_with(p.proname, 'db_public_requirements_')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;
end $$;
