-- ════════════════════════════════════════════════════════════════════════════
--  0011 · jurisdicciones (país, UE, región) y juego online regulado
--
--  Un requisito existe UNA sola vez. Se asocia a las jurisdicciones donde aplica
--  (`requisito_jurisdiccion`) y cada asociación puede llevar un MATIZ (qué cambia
--  allí: umbrales, plazos, organismo, norma) y una FUENTE (norma, URL oficial, fecha,
--  entrada en vigor). Un requisito sin ninguna asociación es «genérico» (vale en
--  cualquier sitio) y sigue siendo el caso de todo el contenido anterior.
--
--  · `jurisdiccion`: códigos ISO 3166-1 alfa-2 (ES, DE…), `EU` para la normativa de la
--    UE y ISO 3166-2 para regiones (ES-CT…). `padre` es el ámbito que la contiene
--    (ES-CT → ES → EU): pedir ES incluye también lo asociado a EU, no a ES-CT.
--  · `srv_buscar` gana `p_paises` (ya expandido a sus ámbitos superiores por la API) y
--    `p_solo_pais` (excluir los genéricos). Sin `p_paises`, se comporta como antes.
--    OJO al fusionar con otras migraciones que toquen `srv_buscar`: aquí se retira la
--    firma de 7 argumentos de la 0004 y se crea la de 9.
--  · Categorías del dominio «juego online regulado»: dominio `regulated-gambling`,
--    arquetipo `online-gambling` y una categoría por modalidad (hereda del arquetipo).
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────── tablas
create table db_public_requirements.jurisdiccion (
  codigo text primary key check (codigo ~ '^(EU|[A-Z]{2}(-[A-Z0-9]{1,3})?)$'),
  tipo   text not null check (tipo in ('supranational', 'country', 'region')),
  nombre text not null check (length(nombre) between 2 and 80),
  padre  text references db_public_requirements.jurisdiccion (codigo) on delete set null,
  orden  int  not null default 100,
  check (padre is distinct from codigo)
);
alter table db_public_requirements.jurisdiccion enable row level security;

create table db_public_requirements.requisito_jurisdiccion (
  requisito_id   bigint not null references db_public_requirements.requisito (id) on delete cascade,
  jurisdiccion   text   not null references db_public_requirements.jurisdiccion (codigo) on delete cascade,
  -- qué cambia en esa jurisdicción (inglés, corto)
  matiz          text check (matiz is null or length(matiz) between 5 and 700),
  fuente_norma   text check (fuente_norma is null or length(fuente_norma) between 3 and 400),
  fuente_url     text check (fuente_url is null or fuente_url ~ '^https://[^[:space:]]{4,255}$'),
  fuente_fecha   date,          -- fecha de la versión del texto consultado (p. ej. «última actualización» del BOE)
  en_vigor_desde date,          -- si es futura, la obligación aún no es exigible
  primary key (requisito_id, jurisdiccion)
);
create index on db_public_requirements.requisito_jurisdiccion (jurisdiccion);
alter table db_public_requirements.requisito_jurisdiccion enable row level security;

insert into db_public_requirements.jurisdiccion (codigo, tipo, nombre, padre, orden) values
  ('EU', 'supranational', 'European Union', null, 10),
  ('ES', 'country', 'Spain', 'EU', 20)
on conflict (codigo) do nothing;

-- ─────────────────────────────────────────────────── categorías del juego regulado
insert into db_public_requirements.categoria (slug, tipo, nombre, descripcion, orden) values
  ('regulated-gambling', 'domain', 'Regulated gambling & betting',
   'Licensed online gambling: sports betting, casino, poker, bingo and contests, with jurisdiction-specific legal duties.', 400)
on conflict (slug) do nothing;

insert into db_public_requirements.categoria (slug, tipo, nombre, descripcion, orden, audiencias) values
  ('online-gambling', 'app_type', 'Online gambling platform (regulated)',
   'Player accounts, deposits and withdrawals, safer-gambling tools, identity and self-exclusion checks, bonuses and regulator reporting.', 30, '{b2c}')
on conflict (slug) do nothing;

insert into db_public_requirements.categoria (slug, tipo, nombre, descripcion, orden, dominio, audiencias, arquetipos) values
  ('gambling-sports-betting', 'software_category', 'Sports & horse-racing betting', 'Fixed-odds and pool betting on sports and racing events, including live betting.', 410, 'regulated-gambling', '{b2c}', '{online-gambling}'),
  ('gambling-casino',         'software_category', 'Online casino games', 'Roulette, blackjack and other casino table games and slots.', 420, 'regulated-gambling', '{b2c}', '{online-gambling}'),
  ('gambling-poker',          'software_category', 'Online poker', 'Cash-game and tournament poker rooms.', 430, 'regulated-gambling', '{b2c}', '{online-gambling}'),
  ('gambling-bingo',          'software_category', 'Online bingo', 'Virtual bingo cards and draws.', 440, 'regulated-gambling', '{b2c}', '{online-gambling}'),
  ('gambling-contests',       'software_category', 'Paid contests & prize draws', 'Contests and raffles with a paid entry.', 450, 'regulated-gambling', '{b2c}', '{online-gambling}')
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────── funciones
-- Alta o actualización de una jurisdicción.
create function public.db_public_requirements_srv_upsert_jurisdiccion(
  p_codigo text, p_tipo text, p_nombre text, p_padre text default null, p_orden int default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_padre is not null and not exists (select 1 from db_public_requirements.jurisdiccion where codigo = p_padre) then
    raise exception 'la jurisdicción padre % no existe', p_padre;
  end if;
  insert into db_public_requirements.jurisdiccion (codigo, tipo, nombre, padre, orden)
  values (p_codigo, p_tipo, p_nombre, p_padre, coalesce(p_orden, 100))
  on conflict (codigo) do update
    set tipo = excluded.tipo, nombre = excluded.nombre, padre = excluded.padre, orden = excluded.orden;
end;
$$;

-- Lista pública de jurisdicciones con cuántos requisitos publicados llevan asociados.
create function public.db_public_requirements_srv_jurisdicciones()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', j.codigo, 'type', j.tipo, 'name', j.nombre, 'parent', j.padre,
           'requirements', (select count(*) from db_public_requirements.requisito_jurisdiccion rj
                              join db_public_requirements.requisito r on r.id = rj.requisito_id
                             where rj.jurisdiccion = j.codigo and r.estado = 'published'))
         order by j.orden, j.codigo), '[]'::jsonb)
  from db_public_requirements.jurisdiccion j
$$;

-- Asocia un requisito (por slug) a una jurisdicción, con matiz y fuente. Idempotente:
-- repetirla actualiza el matiz y la fuente.
create function public.db_public_requirements_srv_asociar_jurisdiccion(
  p_slug text, p_jurisdiccion text, p_matiz text default null, p_fuente_norma text default null,
  p_fuente_url text default null, p_fuente_fecha date default null, p_en_vigor_desde date default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  select id into v_id from db_public_requirements.requisito where slug = p_slug;
  if v_id is null then raise exception 'el requisito % no existe', p_slug; end if;
  if not exists (select 1 from db_public_requirements.jurisdiccion where codigo = p_jurisdiccion) then
    raise exception 'la jurisdicción % no existe', p_jurisdiccion;
  end if;
  insert into db_public_requirements.requisito_jurisdiccion
    (requisito_id, jurisdiccion, matiz, fuente_norma, fuente_url, fuente_fecha, en_vigor_desde)
  values (v_id, p_jurisdiccion, nullif(trim(p_matiz), ''), nullif(trim(p_fuente_norma), ''),
          nullif(trim(p_fuente_url), ''), p_fuente_fecha, p_en_vigor_desde)
  on conflict (requisito_id, jurisdiccion) do update
    set matiz = excluded.matiz, fuente_norma = excluded.fuente_norma, fuente_url = excluded.fuente_url,
        fuente_fecha = excluded.fuente_fecha, en_vigor_desde = excluded.en_vigor_desde;
  return jsonb_build_object('slug', p_slug, 'jurisdiction', p_jurisdiccion);
end;
$$;

-- Jurisdicciones de un conjunto de requisitos:
--   { "<slug>": { "all": ["EU","ES"], "matches": [ {code,name,note,source{…},status} ] } }
-- `all` son TODAS las asociadas (solo códigos). `matches` son solo las que están en
-- `p_paises` (la API ya las ha expandido a sus ámbitos superiores) y llevan matiz y fuente.
-- Sin `p_paises`, `matches` va vacío: así nunca se mezclan los matices de otros países.
create function public.db_public_requirements_srv_jurisdicciones_de(p_slugs text[], p_paises text[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(cardinality(p_slugs), 0) > 200 then raise exception 'demasiados requisitos'; end if;
  return (
    select coalesce(jsonb_object_agg(r.slug, jsonb_build_object(
      'all', coalesce((select jsonb_agg(rj.jurisdiccion order by rj.jurisdiccion)
                         from db_public_requirements.requisito_jurisdiccion rj
                        where rj.requisito_id = r.id), '[]'::jsonb),
      'matches', case when coalesce(cardinality(p_paises), 0) = 0 then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object(
                   'code', rj.jurisdiccion, 'name', j.nombre, 'note', rj.matiz,
                   'source', jsonb_strip_nulls(jsonb_build_object(
                     'norm', rj.fuente_norma, 'url', rj.fuente_url,
                     'date', rj.fuente_fecha, 'in_force_from', rj.en_vigor_desde)),
                   'status', case when rj.en_vigor_desde > current_date then 'upcoming' else 'in_force' end)
                 order by j.orden, j.codigo)
            from db_public_requirements.requisito_jurisdiccion rj
            join db_public_requirements.jurisdiccion j on j.codigo = rj.jurisdiccion
           where rj.requisito_id = r.id and rj.jurisdiccion = any (p_paises)), '[]'::jsonb) end
    )), '{}'::jsonb)
    from db_public_requirements.requisito r
   where r.slug = any (p_slugs) and r.estado = 'published');
end;
$$;

-- ─────────────────────────────────────────────────── búsqueda con país
drop function public.db_public_requirements_srv_buscar(text, text, text[], int, text[], int, text);

create function public.db_public_requirements_srv_buscar(
  p_vec text, p_texto text, p_categorias text[], p_prioridad_max int,
  p_clases text[], p_limite int, p_orden text default null,
  p_paises text[] default null, p_solo_pais boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q   extensions.vector := case when nullif(p_vec, '') is null then null
                                  else p_vec::extensions.vector end;
  v_tsq tsquery := case when nullif(trim(coalesce(p_texto, '')), '') is null then null
                        else websearch_to_tsquery('english', p_texto) end;
  v_orden text;
  v_res jsonb;
begin
  if v_tsq is not null and numnode(v_tsq) = 0 then v_tsq := null; end if;
  v_orden := coalesce(nullif(p_orden, ''), case when v_q is null and v_tsq is null then 'priority' else 'relevance' end);
  if v_orden not in ('priority', 'copies', 'relevance') then
    raise exception 'orden desconocido: %', v_orden;
  end if;

  with filtro as (
    select r.id, r.copias, min(rc.prioridad) as prio
      from db_public_requirements.requisito r
      join db_public_requirements.requisito_categoria rc on rc.requisito_id = r.id
     where r.estado = 'published'
       and (coalesce(cardinality(p_categorias), 0) = 0 or rc.categoria_slug = any (p_categorias))
       and (coalesce(cardinality(p_clases), 0) = 0 or r.clase = any (p_clases))
       -- país: aplica si está asociado a alguno de los pedidos; los genéricos (sin ninguna
       -- asociación) entran salvo que se pida solo lo específico del país
       and (coalesce(cardinality(p_paises), 0) = 0
            or exists (select 1 from db_public_requirements.requisito_jurisdiccion rj
                        where rj.requisito_id = r.id and rj.jurisdiccion = any (p_paises))
            or (not coalesce(p_solo_pais, false)
                and not exists (select 1 from db_public_requirements.requisito_jurisdiccion rj
                                 where rj.requisito_id = r.id)))
     group by r.id, r.copias
    having min(rc.prioridad) <= coalesce(p_prioridad_max, 5)
  ),
  vec as (
    select x.id, row_number() over (order by x.d) as rk
      from (select f.id, r.embedding operator(extensions.<=>) v_q as d
              from filtro f
              join db_public_requirements.requisito r on r.id = f.id
             where v_q is not null and r.embedding is not null
             order by d limit 60) x
  ),
  txt as (
    select y.id, row_number() over (order by y.s desc) as rk
      from (select f.id, ts_rank_cd(r.fts, v_tsq) as s
              from filtro f
              join db_public_requirements.requisito r on r.id = f.id
             where v_tsq is not null and r.fts @@ v_tsq
             order by s desc limit 60) y
  ),
  clasif as (
    select f.id, f.prio, f.copias,
           coalesce(1.0 / (60 + vec.rk), 0) + coalesce(1.0 / (60 + txt.rk), 0) as score
      from filtro f
      left join vec on vec.id = f.id
      left join txt on txt.id = f.id
     where (v_q is null and v_tsq is null) or vec.id is not null or txt.id is not null
     order by (case when v_orden = 'relevance' then coalesce(1.0 / (60 + vec.rk), 0) + coalesce(1.0 / (60 + txt.rk), 0) else 0 end) desc,
              (case when v_orden = 'copies' then f.copias else 0 end) desc,
              f.prio,
              (case when v_orden = 'priority' then f.copias else 0 end) desc,
              f.id
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
  )
  select coalesce(jsonb_agg(db_public_requirements.ficha(k.id, k.prio)
                            order by (case when v_orden = 'relevance' then k.score else 0 end) desc,
                                     (case when v_orden = 'copies' then k.copias else 0 end) desc,
                                     k.prio,
                                     (case when v_orden = 'priority' then k.copias else 0 end) desc,
                                     k.id), '[]'::jsonb)
    into v_res
    from clasif k;

  return v_res;
end;
$$;

-- permisos (idempotente): las funciones nuevas nacen con EXECUTE para PUBLIC
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
