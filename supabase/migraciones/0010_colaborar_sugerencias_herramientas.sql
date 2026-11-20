-- ════════════════════════════════════════════════════════════════════════════
--  0010 · «¿Quieres colaborar?»: sugerencias sobre la app y catálogo de herramientas
--
--  1. Las sugerencias pasan a ser sobre la propia app (airedb): tipos `feature`
--     (una funcionalidad nueva) y `problem` (algo que falla), objetivo `app` sin
--     slug. Lo que faltara de requisitos, tests o aceleradores se aporta por
--     `POST /api/contribute`, no por aquí.
--     COMPATIBLE: las filas antiguas (new_item / improvement / report, con
--     objetivo requirement / test / accelerator / general) siguen siendo válidas y
--     se siguen leyendo; solo cambia lo que acepta `srv_sugerir` para filas nuevas.
--  2. `herramienta`: catálogo de software con código o documentación públicos que
--     una persona (o su agente) puede estudiar para extraer requisitos y
--     aceleradores. Lo lee `GET /api/v1/tools`.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────── sugerencias sobre la app
alter table db_public_requirements.sugerencia drop constraint if exists sugerencia_tipo_check;
alter table db_public_requirements.sugerencia drop constraint if exists sugerencia_objetivo_tipo_check;
alter table db_public_requirements.sugerencia
  add constraint sugerencia_tipo_check
  check (tipo in ('feature', 'problem', 'new_item', 'improvement', 'report'));
alter table db_public_requirements.sugerencia
  add constraint sugerencia_objetivo_tipo_check
  check (objetivo_tipo in ('app', 'requirement', 'test', 'accelerator', 'general'));

-- Misma firma que en 0002 (compatible), pero solo admite sugerencias sobre la app.
create or replace function public.db_public_requirements_srv_sugerir(
  p_autor text, p_tipo text, p_objetivo_tipo text, p_objetivo_slug text, p_texto text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  if coalesce(p_autor, '') = '' then raise exception 'hace falta una cuenta'; end if;
  if p_tipo not in ('feature', 'problem') then raise exception 'tipo de sugerencia no válido'; end if;
  if coalesce(p_objetivo_tipo, 'app') <> 'app' or nullif(p_objetivo_slug, '') is not null then
    raise exception 'las sugerencias son sobre la app';
  end if;
  if (select count(*) from db_public_requirements.sugerencia
       where autor = p_autor and creada_en > now() - interval '1 day') >= 20 then
    raise exception 'demasiadas sugerencias hoy';
  end if;
  insert into db_public_requirements.sugerencia (autor, tipo, objetivo_tipo, objetivo_slug, texto)
  values (p_autor, p_tipo, 'app', null, trim(p_texto))
  returning id into v_id;
  return v_id;
end;
$$;

-- ─────────────────────────────────────────────────── herramientas
create table db_public_requirements.herramienta (
  id            bigserial primary key,
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  nombre        text not null check (length(nombre) between 1 and 80),
  categoria     text not null check (categoria in (
                  'framework', 'library', 'auth', 'payments', 'database', 'backend', 'cms', 'ecommerce',
                  'devops', 'ai', 'analytics', 'communication', 'storage', 'other')),
  descripcion   text not null default '' check (length(descripcion) <= 300),
  url_codigo    text check (url_codigo is null or url_codigo ~ '^https://[^\s]+$'),
  url_docs      text check (url_docs is null or url_docs ~ '^https://[^\s]+$'),
  plataformas   text[] not null default '{}',
  estado        text not null default 'active' check (estado in ('active', 'hidden')),
  orden         int  not null default 100,
  creada_en     timestamptz not null default now(),
  check (url_codigo is not null or url_docs is not null)
);
create index on db_public_requirements.herramienta (estado, orden, nombre);

-- Catálogo público (solo las activas), ya ordenado.
create function public.db_public_requirements_srv_herramientas()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', h.slug, 'name', h.nombre, 'category', h.categoria, 'description', h.descripcion,
           'code_url', h.url_codigo, 'docs_url', h.url_docs, 'platforms', to_jsonb(h.plataformas))
         order by h.orden, h.nombre), '[]'::jsonb)
    from db_public_requirements.herramienta h
   where h.estado = 'active'
$$;

-- Carga y actualiza una herramienta (lo usa scripts/sembrar_herramientas.mjs).
create function public.db_public_requirements_srv_upsert_herramienta(
  p_slug text, p_nombre text, p_categoria text, p_descripcion text,
  p_url_codigo text, p_url_docs text, p_plataformas text[], p_estado text, p_orden int)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into db_public_requirements.herramienta
    (slug, nombre, categoria, descripcion, url_codigo, url_docs, plataformas, estado, orden)
  values (p_slug, p_nombre, p_categoria, coalesce(p_descripcion, ''), nullif(p_url_codigo, ''), nullif(p_url_docs, ''),
          coalesce(p_plataformas, '{}'), coalesce(p_estado, 'active'), coalesce(p_orden, 100))
  on conflict (slug) do update
    set nombre = excluded.nombre, categoria = excluded.categoria, descripcion = excluded.descripcion,
        url_codigo = excluded.url_codigo, url_docs = excluded.url_docs, plataformas = excluded.plataformas,
        estado = excluded.estado, orden = excluded.orden;
end;
$$;

-- ─────────────────────────────────────────────────── permisos (idempotente)
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

-- ─────────────────────────────────────────────────────────── cinturón
alter table db_public_requirements.herramienta enable row level security;
