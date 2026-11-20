-- ════════════════════════════════════════════════════════════════════════════
--  0009 · métricas de popularidad de los aceleradores
--
--  Estrellas de GitHub y descargas por registro oficial (npm, PyPI, crates.io,
--  NuGet, RubyGems, Packagist, Homebrew…), refrescadas por un proceso quincenal
--  (GET/POST /api/cron/metricas). Decisión de modelo: columnas en `acelerador`
--  y NO tabla hija con historial. Hoy solo se enseña el último valor, una fila
--  por acelerador evita un join en cada ficha y en la ordenación por
--  popularidad; si algún día hace falta la evolución, se añade una tabla
--  `acelerador_metrica` sin romper nada de esto.
--
--  Las métricas son datos públicos de lectura. El disparador de fechas de
--  contenido (0005, tocar_fecha_acelerador) compara solo columnas de contenido,
--  así que refrescar métricas NO mueve `actualizado_en`.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────── validación de nombres de paquete
-- Formatos de cada registro. Se comprueba en la tabla (CHECK) y en srv_fijar_origen.
create function db_public_requirements.paquete_valido(p_registro text, p_paquete text)
returns boolean language sql immutable set search_path = '' as $$
  select case p_registro
    when 'npm'       then p_paquete ~* '^(@[a-z0-9~-][a-z0-9._~-]*/)?[a-z0-9~-][a-z0-9._~-]*$' and length(p_paquete) <= 214
    when 'pypi'      then p_paquete ~ '^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$' and length(p_paquete) <= 100
    when 'crates'    then p_paquete ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
    when 'nuget'     then p_paquete ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
    when 'rubygems'  then p_paquete ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
    when 'packagist' then p_paquete ~ '^[a-z0-9]([_.-]?[a-z0-9]+)*/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$' and length(p_paquete) <= 150
    when 'maven'     then p_paquete ~ '^[A-Za-z0-9_.-]{1,100}:[A-Za-z0-9_.-]{1,100}$'
    when 'go'        then p_paquete ~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(/[A-Za-z0-9._~-]+)*$' and length(p_paquete) <= 200
    when 'homebrew'  then p_paquete ~ '^[a-z0-9][a-z0-9@+._-]{0,79}$'
    else false
  end
$$;

-- ─────────────────────────────────────────────────── columnas nuevas
alter table db_public_requirements.acelerador
  add column repo_url                 text,
  add column stars                    bigint,
  add column forks                    bigint,
  add column archivado                boolean,
  add column ultimo_commit            timestamptz,
  add column registro                 text,
  add column paquete                  text,
  add column descargas_mes            bigint,
  add column descargas_total          bigint,
  add column metricas_fuente          text,
  add column metricas_actualizado_en  timestamptz,   -- último refresco con algún dato nuevo
  add column metricas_intentado_en    timestamptz,   -- último intento (con o sin error): marca lo que falta
  add column metricas_error           text;

alter table db_public_requirements.acelerador
  add constraint acelerador_repo_url_ok     check (repo_url is null or (repo_url ~ '^https://[^[:space:]]+$' and length(repo_url) <= 300)),
  add constraint acelerador_registro_ok     check (registro is null or registro in
    ('npm', 'pypi', 'crates', 'nuget', 'rubygems', 'packagist', 'maven', 'go', 'homebrew')),
  add constraint acelerador_paquete_ok      check ((registro is null) = (paquete is null)
    and (paquete is null or db_public_requirements.paquete_valido(registro, paquete))),
  add constraint acelerador_metricas_ok     check (
        coalesce(stars, 0) >= 0 and coalesce(forks, 0) >= 0
    and coalesce(descargas_mes, 0) >= 0 and coalesce(descargas_total, 0) >= 0),
  add constraint acelerador_metricas_error_ok check (metricas_error is null or length(metricas_error) <= 300),
  add constraint acelerador_metricas_fuente_ok check (metricas_fuente is null or length(metricas_fuente) <= 80);

-- Para sacar los pendientes por orden de antigüedad.
create index acelerador_metricas_pendientes_idx
  on db_public_requirements.acelerador (metricas_intentado_en nulls first, id)
  where estado = 'published' and (repo_url is not null or registro is not null);

-- Popularidad para ordenar: estrellas y descargas mensuales en escala logarítmica
-- (las descargas son órdenes de magnitud mayores que las estrellas). Lo desconocido vale 0.
create function db_public_requirements.popularidad(p_stars bigint, p_descargas bigint)
returns double precision language sql immutable set search_path = '' as $$
  select ln(1 + coalesce(p_stars, 0)::double precision) + ln(1 + coalesce(p_descargas, 0)::double precision) / 2
$$;

-- ─────────────────────────────────────────────────── ficha: las métricas se publican
create or replace function db_public_requirements.ficha_acelerador(p_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', a.slug, 'name', a.nombre, 'description', a.descripcion,
    'model', a.modelo, 'cost', a.coste, 'url', a.url, 'platforms', to_jsonb(a.plataformas),
    'repo_url', a.repo_url, 'registry', a.registro, 'package', a.paquete,
    'stars', a.stars, 'forks', a.forks, 'archived', a.archivado, 'last_commit', a.ultimo_commit,
    'downloads_month', a.descargas_mes, 'downloads_total', a.descargas_total,
    'metrics_source', a.metricas_fuente, 'metrics_updated_at', a.metricas_actualizado_en,
    'requirements', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'coverage', ar.cobertura)
                                               order by r.slug)
                                from db_public_requirements.acelerador_requisito ar
                                join db_public_requirements.requisito r on r.id = ar.requisito_id
                               where ar.acelerador_id = a.id and r.estado = 'published'), '[]'::jsonb))
  from db_public_requirements.acelerador a where a.id = p_id
$$;

-- ─────────────────────────────────────────────────── relacionados: los aceleradores de un requisito
create or replace function public.db_public_requirements_srv_relacionados(
  p_slugs text[], p_tests boolean, p_tests_max int, p_aceleradores boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(cardinality(p_slugs), 0) > 200 then raise exception 'demasiados requisitos'; end if;
  return (
    select coalesce(jsonb_object_agg(r.slug, jsonb_build_object(
      'tests', case when p_tests then coalesce((
          select jsonb_agg(jsonb_build_object('slug', t.slug, 'title', t.titulo, 'scenario', t.escenario,
                                              'type', t.tipo, 'priority', t.prioridad)
                           order by t.prioridad, t.titulo)
            from db_public_requirements.test_requisito tr
            join db_public_requirements.test t on t.id = tr.test_id
           where tr.requisito_id = r.id and t.estado = 'published'
             and t.prioridad <= coalesce(p_tests_max, 5)), '[]'::jsonb) else '[]'::jsonb end,
      'accelerators', case when p_aceleradores then coalesce((
          select jsonb_agg(jsonb_build_object('slug', a.slug, 'name', a.nombre, 'model', a.modelo,
                                              'cost', a.coste, 'url', a.url, 'coverage', ar.cobertura,
                                              'stars', a.stars, 'downloads_month', a.descargas_mes,
                                              'downloads_total', a.descargas_total,
                                              'registry', a.registro, 'archived', a.archivado,
                                              'metrics_updated_at', a.metricas_actualizado_en)
                           order by ar.cobertura, a.nombre)
            from db_public_requirements.acelerador_requisito ar
            join db_public_requirements.acelerador a on a.id = ar.acelerador_id
           where ar.requisito_id = r.id and a.estado = 'published'), '[]'::jsonb) else '[]'::jsonb end
    )), '{}'::jsonb)
    from db_public_requirements.requisito r
   where r.slug = any (p_slugs) and r.estado = 'published');
end;
$$;

-- ─────────────────────────────────────────────────── búsqueda con orden por popularidad
-- Se cambia la firma (p_orden nuevo, con valor por defecto): se borra la antigua para que
-- no queden dos sobrecargas. Quien llame sin p_orden (código anterior) sigue funcionando.
drop function public.db_public_requirements_srv_buscar_aceleradores(text, text, text[], text[], text[], int);

create function public.db_public_requirements_srv_buscar_aceleradores(
  p_vec text, p_texto text, p_categorias text[], p_modelos text[],
  p_plataformas text[], p_limite int, p_orden text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q   extensions.vector := case when nullif(p_vec, '') is null then null else p_vec::extensions.vector end;
  v_tsq tsquery := case when nullif(trim(coalesce(p_texto, '')), '') is null then null
                        else websearch_to_tsquery('english', p_texto) end;
  v_res jsonb;
begin
  if v_tsq is not null and numnode(v_tsq) = 0 then v_tsq := null; end if;
  if p_orden is not null and p_orden not in ('relevance', 'popularity') then
    raise exception 'orden desconocido: %', p_orden;
  end if;

  with filtro as (
    select a.id,
           db_public_requirements.popularidad(a.stars, a.descargas_mes) as pop,
           (select count(*) from db_public_requirements.acelerador_requisito ar where ar.acelerador_id = a.id) as n
      from db_public_requirements.acelerador a
     where a.estado = 'published'
       and (coalesce(cardinality(p_modelos), 0) = 0 or a.modelo = any (p_modelos))
       -- «any» (cualquier plataforma) casa con todo
       and (coalesce(cardinality(p_plataformas), 0) = 0
            or a.plataformas && p_plataformas or 'any' = any (a.plataformas))
       and (coalesce(cardinality(p_categorias), 0) = 0 or exists (
              select 1 from db_public_requirements.acelerador_requisito ar
                join db_public_requirements.requisito_categoria rc on rc.requisito_id = ar.requisito_id
               where ar.acelerador_id = a.id and rc.categoria_slug = any (p_categorias)))
  ),
  vec as (
    select x.id, row_number() over (order by x.d) as rk
      from (select f.id, a.embedding operator(extensions.<=>) v_q as d
              from filtro f join db_public_requirements.acelerador a on a.id = f.id
             where v_q is not null and a.embedding is not null order by d limit 60) x
  ),
  txt as (
    select y.id, row_number() over (order by y.s desc) as rk
      from (select f.id, ts_rank_cd(a.fts, v_tsq) as s
              from filtro f join db_public_requirements.acelerador a on a.id = f.id
             where v_tsq is not null and a.fts @@ v_tsq order by s desc limit 60) y
  ),
  clasif as (
    select f.id, f.n, f.pop,
           coalesce(1.0 / (60 + vec.rk), 0) + coalesce(1.0 / (60 + txt.rk), 0) as score
      from filtro f
      left join vec on vec.id = f.id
      left join txt on txt.id = f.id
     where (v_q is null and v_tsq is null) or vec.id is not null or txt.id is not null
     order by case when p_orden = 'popularity' then f.pop end desc nulls last,
              score desc, f.n desc, f.id
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
  )
  select coalesce(jsonb_agg(db_public_requirements.ficha_acelerador(k.id)
                            order by case when p_orden = 'popularity' then k.pop end desc nulls last,
                                     k.score desc, k.n desc, k.id), '[]'::jsonb)
    into v_res from clasif k;
  return v_res;
end;
$$;

-- ─────────────────────────────────────────────────── proceso de refresco
-- Los pendientes, los de intento más antiguo primero (los nunca intentados, los primeros).
-- p_antes_de: solo los no intentados desde esa fecha (la API pasa «hace 14 días»; un
-- refresco forzado pasa «ahora» y se para solo, porque lo ya refrescado queda posterior).
create function public.db_public_requirements_srv_metricas_pendientes(
  p_limite int, p_antes_de timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.fila order by x.intento nulls first, x.id), '[]'::jsonb)
    from (select a.id, a.metricas_intentado_en as intento,
                 jsonb_build_object('slug', a.slug, 'repo_url', a.repo_url,
                                    'registry', a.registro, 'package', a.paquete) as fila
            from db_public_requirements.acelerador a
           where a.estado = 'published'
             and (a.repo_url is not null or a.registro is not null)
             and (a.metricas_intentado_en is null or a.metricas_intentado_en < p_antes_de)
           order by a.metricas_intentado_en nulls first, a.id
           limit least(greatest(coalesce(p_limite, 20), 1), 100)) x
$$;

-- Cuántos hay en total con origen y cuántos pendientes (para el informe del cron).
create function public.db_public_requirements_srv_metricas_resumen(p_antes_de timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'with_source', count(*),
    'pending', count(*) filter (where a.metricas_intentado_en is null or a.metricas_intentado_en < p_antes_de),
    'with_error', count(*) filter (where a.metricas_error is not null))
    from db_public_requirements.acelerador a
   where a.estado = 'published' and (a.repo_url is not null or a.registro is not null)
$$;

-- Guarda el resultado de un refresco. p_datos (jsonb), todas las claves opcionales:
--   stars, forks, archived, last_commit, downloads_month, downloads_total, source, error
-- Lo que no viene se conserva. Con «error» se guarda el aviso (y los datos que sí llegaron).
-- Siempre marca el intento. Un refresco sin error borra el error anterior.
create function public.db_public_requirements_srv_guardar_metricas(p_slug text, p_datos jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id    bigint;
  v_error text := left(nullif(trim(coalesce(p_datos->>'error', '')), ''), 300);
  v_dato  boolean := false;
  v_n     text;
begin
  if jsonb_typeof(p_datos) is distinct from 'object' then raise exception 'p_datos debe ser un objeto'; end if;
  select id into v_id from db_public_requirements.acelerador where slug = p_slug;
  if v_id is null then raise exception 'acelerador desconocido: %', p_slug; end if;

  foreach v_n in array array['stars', 'forks', 'downloads_month', 'downloads_total'] loop
    if p_datos ? v_n and jsonb_typeof(p_datos->v_n) <> 'null'
       and (jsonb_typeof(p_datos->v_n) <> 'number' or (p_datos->>v_n)::numeric < 0
            or (p_datos->>v_n)::numeric > 9e15 or (p_datos->>v_n)::numeric <> trunc((p_datos->>v_n)::numeric)) then
      raise exception '% debe ser un entero >= 0', v_n;
    end if;
  end loop;

  update db_public_requirements.acelerador a set
    stars           = case when p_datos ? 'stars'           and jsonb_typeof(p_datos->'stars') = 'number'           then (p_datos->>'stars')::bigint else a.stars end,
    forks           = case when p_datos ? 'forks'           and jsonb_typeof(p_datos->'forks') = 'number'           then (p_datos->>'forks')::bigint else a.forks end,
    descargas_mes   = case when p_datos ? 'downloads_month' and jsonb_typeof(p_datos->'downloads_month') = 'number' then (p_datos->>'downloads_month')::bigint else a.descargas_mes end,
    descargas_total = case when p_datos ? 'downloads_total' and jsonb_typeof(p_datos->'downloads_total') = 'number' then (p_datos->>'downloads_total')::bigint else a.descargas_total end,
    archivado       = case when p_datos ? 'archived'        and jsonb_typeof(p_datos->'archived') = 'boolean'       then (p_datos->>'archived')::boolean else a.archivado end,
    ultimo_commit   = case when p_datos ? 'last_commit'     and jsonb_typeof(p_datos->'last_commit') = 'string'     then (p_datos->>'last_commit')::timestamptz else a.ultimo_commit end,
    metricas_fuente = case when p_datos ? 'source' then left(nullif(p_datos->>'source', ''), 80) else a.metricas_fuente end,
    metricas_error  = v_error,
    metricas_intentado_en = now(),
    metricas_actualizado_en = case
      when p_datos ?| array['stars', 'forks', 'archived', 'last_commit', 'downloads_month', 'downloads_total']
        then now() else a.metricas_actualizado_en end
  where a.id = v_id;

  return jsonb_build_object('slug', p_slug, 'saved', true, 'error', v_error);
end;
$$;

-- ─────────────────────────────────────────────────── de dónde salen las métricas
-- Lo usa el relleno inicial (scripts/rellenar_origen_metricas.mjs) y, más adelante, quien
-- revise un acelerador. Valida los formatos; no toca fechas de contenido.
create function public.db_public_requirements_srv_fijar_origen(
  p_slug text, p_repo_url text, p_registro text, p_paquete text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  select id into v_id from db_public_requirements.acelerador where slug = p_slug;
  if v_id is null then raise exception 'acelerador desconocido: %', p_slug; end if;
  if p_repo_url is not null and (p_repo_url !~ '^https://[^[:space:]]+$' or length(p_repo_url) > 300) then
    raise exception 'repo_url debe ser una URL https de hasta 300 caracteres';
  end if;
  if (p_registro is null) <> (p_paquete is null) then raise exception 'registro y paquete van juntos'; end if;
  if p_registro is not null and not db_public_requirements.paquete_valido(p_registro, p_paquete) then
    raise exception 'registro o nombre de paquete no válidos: % %', p_registro, p_paquete;
  end if;
  update db_public_requirements.acelerador
     set repo_url = p_repo_url, registro = p_registro, paquete = p_paquete,
         -- si cambia el origen, lo medido antes ya no vale como «último intento»
         metricas_intentado_en = null
   where id = v_id
     and (repo_url, registro, paquete) is distinct from (p_repo_url, p_registro, p_paquete);
  return jsonb_build_object('slug', p_slug, 'repo_url', p_repo_url, 'registry', p_registro, 'package', p_paquete);
end;
$$;

-- Aceleradores por páginas (id creciente), para el relleno inicial.
create function public.db_public_requirements_srv_aceleradores_origen(p_despues_de bigint, p_limite int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'slug', x.slug, 'url', x.url,
           'repo_url', x.repo_url, 'registry', x.registro, 'package', x.paquete, 'model', x.modelo) order by x.id), '[]'::jsonb)
    from (select a.* from db_public_requirements.acelerador a
           where a.estado = 'published' and a.id > coalesce(p_despues_de, 0)
           order by a.id limit least(greatest(coalesce(p_limite, 200), 1), 500)) x
$$;

-- ─────────────────────────────────────────────────── permisos (idempotente, igual que 0003-0005)
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
