-- ════════════════════════════════════════════════════════════════════════════
--  db_public_requirements · esquema en la base compartida de la home
--
--  Base pública de requisitos para quien hace vibe coding. Contrato (AGENTS.md):
--    · Todo vive en el esquema db_public_requirements. Nada en public salvo las
--      funciones.
--    · El esquema NO se expone a la API de Supabase.
--    · RLS activo en todas las tablas y SIN políticas.
--    · La única puerta son funciones public.db_public_requirements_srv_<verbo>().
--
--  Diferencia con la plantilla: aquí NADA se concede a anon ni a authenticated.
--  Toda llamada pasa por api/ (Vercel), que verifica la sesión de Clerk o la API
--  key, aplica el cupo, calcula los embeddings con Gemini y llama a estas
--  funciones con la clave secreta (service_role). El navegador nunca habla
--  directamente con la base.
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create schema if not exists db_public_requirements;

revoke all on schema db_public_requirements from public, anon, authenticated;
grant usage on schema db_public_requirements to service_role;

-- ─────────────────────────────────────────────────────────── tablas
-- Categorías: tipo de app, tipo de pantalla (solo para filtrar: un requisito
-- nunca dice DÓNDE va la funcionalidad) y transversales (seguridad, etc.).
create table db_public_requirements.categoria (
  slug        text primary key check (slug ~ '^[a-z0-9][a-z0-9_-]{1,59}$'),
  tipo        text not null check (tipo in ('app_type', 'screen_type', 'cross_cutting')),
  nombre      text not null check (length(nombre) between 2 and 80),
  descripcion text not null default '' check (length(descripcion) <= 500),
  orden       int  not null default 100
);

create table db_public_requirements.requisito (
  id             bigserial primary key,
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{3,119}$'),
  titulo         text not null check (length(titulo) between 5 and 120),
  enunciado      text not null check (length(enunciado) between 10 and 1000),
  -- criterios de aceptación: array de strings, máx. 12
  criterios      jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(criterios) = 'array' and jsonb_array_length(criterios) <= 12),
  clase          text not null check (clase in ('functional', 'security', 'privacy', 'technical',
                   'ux', 'performance', 'reliability', 'legal', 'accessibility')),
  embedding      extensions.vector(768),
  fts            tsvector generated always as
                   (to_tsvector('english', titulo || ' ' || enunciado)) stored,
  estado         text not null default 'published' check (estado in ('published', 'archived')),
  version        int  not null default 1,
  autor          text,                          -- sub de Clerk, o null (semilla / borrado)
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index on db_public_requirements.requisito using gin (fts);
create index on db_public_requirements.requisito
  using hnsw (embedding extensions.vector_cosine_ops);

-- La prioridad va POR CATEGORÍA: el cifrado extremo a extremo es 1 en una app
-- de mensajería y 3 en un SaaS. 1 = imprescindible … 5 = diferenciador.
create table db_public_requirements.requisito_categoria (
  requisito_id   bigint   not null references db_public_requirements.requisito (id) on delete cascade,
  categoria_slug text     not null references db_public_requirements.categoria (slug) on delete cascade,
  prioridad      smallint not null check (prioridad between 1 and 5),
  primary key (requisito_id, categoria_slug)
);
create index on db_public_requirements.requisito_categoria (categoria_slug, prioridad);

create table db_public_requirements.aporte (
  id                   bigserial primary key,
  autor                text,
  texto                text not null check (length(texto) between 10 and 4000),
  categorias_sugeridas text[] not null default '{}' check (cardinality(categorias_sugeridas) <= 12),
  estado               text not null default 'pending'
                         check (estado in ('pending', 'created', 'merged', 'rejected', 'needs_human')),
  veredicto            jsonb,
  requisito_id         bigint references db_public_requirements.requisito (id) on delete set null,
  creado_en            timestamptz not null default now(),
  resuelto_en          timestamptz
);
create index on db_public_requirements.aporte (autor, creado_en);

-- Historial: la versión ANTERIOR de cada requisito fusionado o editado.
create table db_public_requirements.requisito_version (
  id           bigserial primary key,
  requisito_id bigint not null references db_public_requirements.requisito (id) on delete cascade,
  version      int    not null,
  titulo       text   not null,
  enunciado    text   not null,
  criterios    jsonb  not null,
  aporte_id    bigint references db_public_requirements.aporte (id) on delete set null,
  creado_en    timestamptz not null default now()
);
create index on db_public_requirements.requisito_version (requisito_id, version);

-- Solo se guarda el hash de la clave: la clave en claro se enseña una vez.
create table db_public_requirements.api_key (
  id         bigserial primary key,
  duenyo     text not null,
  prefijo    text not null,
  hash       text not null unique,
  nombre     text not null check (length(nombre) between 1 and 60),
  creada_en  timestamptz not null default now(),
  ultimo_uso timestamptz,
  revocada_en timestamptz
);
create index on db_public_requirements.api_key (duenyo);

-- Cupo por ventana (minuto y día). En serverless no vale un contador en memoria.
create table db_public_requirements.cupo (
  clave   text        not null,
  ventana timestamptz not null,
  n       int         not null default 0,
  primary key (clave, ventana)
);
create index on db_public_requirements.cupo (ventana);

-- Caché texto → vector de las búsquedas, para no pagar a Gemini dos veces.
create table db_public_requirements.embedding_consulta (
  hash      text primary key,
  embedding extensions.vector(768) not null,
  creado_en timestamptz not null default now()
);

-- ─────────────────────────────────────────────────── ayudas internas
-- Viven en el esquema privado: nadie fuera de service_role las ve.
create function db_public_requirements.slugify(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select left(trim(both '-' from regexp_replace(lower(p_texto), '[^a-z0-9]+', '-', 'g')), 110)
$$;

-- La «ficha» de un requisito tal y como la ve la API. p_prio permite fijar la
-- prioridad efectiva (la de las categorías pedidas); sin él, la mejor que tenga.
create function db_public_requirements.ficha(p_id bigint, p_prio int default null)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', r.slug,
    'title', r.titulo,
    'statement', r.enunciado,
    'criteria', r.criterios,
    'kind', r.clase,
    'priority', coalesce(p_prio, (select min(c.prioridad)
                                    from db_public_requirements.requisito_categoria c
                                   where c.requisito_id = r.id)),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('slug', c.categoria_slug,
                                                                'priority', c.prioridad)
                                             order by c.prioridad, c.categoria_slug)
                              from db_public_requirements.requisito_categoria c
                             where c.requisito_id = r.id), '[]'::jsonb),
    'version', r.version,
    'updated_at', r.actualizado_en)
  from db_public_requirements.requisito r
  where r.id = p_id
$$;

-- ─────────────────────────────────────────────────── lectura
create function public.db_public_requirements_srv_categorias()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', c.slug, 'type', c.tipo, 'name', c.nombre, 'description', c.descripcion,
           'requirements', (select count(*) from db_public_requirements.requisito_categoria rc
                              join db_public_requirements.requisito r on r.id = rc.requisito_id
                             where rc.categoria_slug = c.slug and r.estado = 'published'))
         order by c.tipo, c.orden, c.nombre), '[]'::jsonb)
  from db_public_requirements.categoria c
$$;

create function public.db_public_requirements_srv_requisito(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select db_public_requirements.ficha(r.id)
    from db_public_requirements.requisito r
   where r.slug = p_slug and r.estado = 'published'
$$;

-- Búsqueda híbrida: vector (significado) + texto completo, fusionados con RRF.
-- Los filtros van ANTES: categoría, clase y prioridad máxima. Con categorías
-- pedidas, la prioridad efectiva es la mejor de las categorías pedidas.
-- Sin consulta de texto ni vector, lista ordenada por prioridad.
create function public.db_public_requirements_srv_buscar(
  p_vec text, p_texto text, p_categorias text[], p_prioridad_max int,
  p_clases text[], p_limite int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q   extensions.vector := case when nullif(p_vec, '') is null then null
                                  else p_vec::extensions.vector end;
  v_tsq tsquery := case when nullif(trim(coalesce(p_texto, '')), '') is null then null
                        else websearch_to_tsquery('english', p_texto) end;
  v_res jsonb;
begin
  if v_tsq is not null and numnode(v_tsq) = 0 then v_tsq := null; end if;

  with filtro as (
    select r.id, min(rc.prioridad) as prio
      from db_public_requirements.requisito r
      join db_public_requirements.requisito_categoria rc on rc.requisito_id = r.id
     where r.estado = 'published'
       and (coalesce(cardinality(p_categorias), 0) = 0 or rc.categoria_slug = any (p_categorias))
       and (coalesce(cardinality(p_clases), 0) = 0 or r.clase = any (p_clases))
     group by r.id
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
    select f.id, f.prio,
           coalesce(1.0 / (60 + vec.rk), 0) + coalesce(1.0 / (60 + txt.rk), 0) as score
      from filtro f
      left join vec on vec.id = f.id
      left join txt on txt.id = f.id
     where (v_q is null and v_tsq is null) or vec.id is not null or txt.id is not null
     order by score desc, f.prio, f.id
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
  )
  select coalesce(jsonb_agg(db_public_requirements.ficha(k.id, k.prio)
                            order by k.score desc, k.prio, k.id), '[]'::jsonb)
    into v_res
    from clasif k;

  return v_res;
end;
$$;

create function public.db_public_requirements_srv_similares(p_vec text, p_n int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.d), '[]'::jsonb)
    from (select db_public_requirements.ficha(r.id)
                   || jsonb_build_object('id', r.id,
                        'similarity', round((1 - (r.embedding operator(extensions.<=>)
                                                  p_vec::extensions.vector))::numeric, 4)) as j,
                 r.embedding operator(extensions.<=>) p_vec::extensions.vector as d
            from db_public_requirements.requisito r
           where r.estado = 'published' and r.embedding is not null
           order by d
           limit least(greatest(coalesce(p_n, 5), 1), 20)) x
$$;

-- ─────────────────────────────────────────────────── cupos y caché
create function public.db_public_requirements_srv_cupo(
  p_clave text, p_limite_min int, p_limite_dia int)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ahora timestamptz := now();
  v_min int; v_dia int;
begin
  if length(coalesce(p_clave, '')) not between 1 and 120 then
    raise exception 'clave de cupo inválida';
  end if;

  insert into db_public_requirements.cupo (clave, ventana, n)
  values (p_clave || '|m', date_trunc('minute', v_ahora), 1)
  on conflict (clave, ventana) do update set n = db_public_requirements.cupo.n + 1
  returning n into v_min;

  insert into db_public_requirements.cupo (clave, ventana, n)
  values (p_clave || '|d', date_trunc('day', v_ahora), 1)
  on conflict (clave, ventana) do update set n = db_public_requirements.cupo.n + 1
  returning n into v_dia;

  -- Limpieza oportunista: sin pg_cron, una de cada cien llamadas barre lo viejo.
  if random() < 0.01 then
    delete from db_public_requirements.cupo where ventana < v_ahora - interval '2 days';
  end if;

  if v_min > p_limite_min then
    return jsonb_build_object('allowed', false, 'scope', 'minute',
             'retry_after', greatest(1, 60 - extract(second from v_ahora)::int));
  elsif v_dia > p_limite_dia then
    return jsonb_build_object('allowed', false, 'scope', 'day',
             'retry_after', greatest(1, extract(epoch from
               (date_trunc('day', v_ahora) + interval '1 day' - v_ahora))::int));
  end if;
  return jsonb_build_object('allowed', true,
           'remaining_minute', p_limite_min - v_min, 'remaining_day', p_limite_dia - v_dia);
end;
$$;

create function public.db_public_requirements_srv_embedding_get(p_hash text)
returns text language sql stable security definer set search_path = '' as $$
  select embedding::text from db_public_requirements.embedding_consulta where hash = p_hash
$$;

create function public.db_public_requirements_srv_embedding_put(p_hash text, p_vec text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if length(coalesce(p_hash, '')) <> 64 then raise exception 'hash inválido'; end if;
  insert into db_public_requirements.embedding_consulta (hash, embedding)
  values (p_hash, p_vec::extensions.vector)
  on conflict (hash) do nothing;
  if random() < 0.02 then
    delete from db_public_requirements.embedding_consulta
     where creado_en < now() - interval '30 days';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────── escritura de contenido
create function public.db_public_requirements_srv_upsert_categoria(
  p_slug text, p_tipo text, p_nombre text, p_descripcion text, p_orden int)
returns void language sql volatile security definer set search_path = '' as $$
  insert into db_public_requirements.categoria (slug, tipo, nombre, descripcion, orden)
  values (p_slug, p_tipo, p_nombre, coalesce(p_descripcion, ''), coalesce(p_orden, 100))
  on conflict (slug) do update
    set tipo = excluded.tipo, nombre = excluded.nombre,
        descripcion = excluded.descripcion, orden = excluded.orden
$$;

-- p_categorias: [{"slug": "messaging", "priority": 1}, …]
-- Con p_slug (la semilla) es idempotente: si ya existe, no toca nada.
create function public.db_public_requirements_srv_crear_requisito(
  p_titulo text, p_enunciado text, p_criterios jsonb, p_clase text,
  p_categorias jsonb, p_vec text,
  p_autor text default null, p_aporte_id bigint default null, p_slug text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id bigint; v_base text; v_slug text; v_n int := 1; c jsonb;
begin
  if p_categorias is null or jsonb_typeof(p_categorias) <> 'array'
     or jsonb_array_length(p_categorias) not between 1 and 12 then
    raise exception 'hacen falta entre 1 y 12 categorías';
  end if;

  if nullif(p_slug, '') is not null then
    select id into v_id from db_public_requirements.requisito where slug = p_slug;
    if found then return jsonb_build_object('id', v_id, 'slug', p_slug, 'created', false); end if;
    v_slug := p_slug;
  else
    v_base := db_public_requirements.slugify(p_titulo);
    v_slug := v_base;
    while exists (select 1 from db_public_requirements.requisito where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n;
    end loop;
  end if;

  insert into db_public_requirements.requisito
    (slug, titulo, enunciado, criterios, clase, embedding, autor)
  values (v_slug, trim(p_titulo), trim(p_enunciado), coalesce(p_criterios, '[]'::jsonb), p_clase,
          nullif(p_vec, '')::extensions.vector, p_autor)
  returning id into v_id;

  for c in select * from jsonb_array_elements(p_categorias) loop
    insert into db_public_requirements.requisito_categoria (requisito_id, categoria_slug, prioridad)
    values (v_id, c->>'slug', (c->>'priority')::smallint)
    on conflict do nothing;
  end loop;

  if p_aporte_id is not null then
    update db_public_requirements.aporte
       set estado = 'created', requisito_id = v_id, resuelto_en = now()
     where id = p_aporte_id;
  end if;
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'created', true);
end;
$$;

-- Fusionar guarda la versión anterior, sube la versión y AÑADE categorías
-- nuevas. Las prioridades que ya existen no las cambia una fusión: eso lo
-- decide una persona.
create function public.db_public_requirements_srv_fusionar(
  p_requisito_id bigint, p_titulo text, p_enunciado text, p_criterios jsonb,
  p_categorias jsonb, p_vec text, p_aporte_id bigint default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r db_public_requirements.requisito; c jsonb;
begin
  select * into r from db_public_requirements.requisito
   where id = p_requisito_id and estado = 'published' for update;
  if not found then raise exception 'el requisito no existe'; end if;

  insert into db_public_requirements.requisito_version
    (requisito_id, version, titulo, enunciado, criterios, aporte_id)
  values (r.id, r.version, r.titulo, r.enunciado, r.criterios, p_aporte_id);

  update db_public_requirements.requisito
     set titulo = trim(p_titulo), enunciado = trim(p_enunciado),
         criterios = coalesce(p_criterios, criterios),
         embedding = coalesce(nullif(p_vec, '')::extensions.vector, embedding),
         version = version + 1, actualizado_en = now()
   where id = r.id;

  if p_categorias is not null and jsonb_typeof(p_categorias) = 'array' then
    for c in select * from jsonb_array_elements(p_categorias) loop
      insert into db_public_requirements.requisito_categoria (requisito_id, categoria_slug, prioridad)
      values (r.id, c->>'slug', (c->>'priority')::smallint)
      on conflict do nothing;
    end loop;
  end if;

  if p_aporte_id is not null then
    update db_public_requirements.aporte
       set estado = 'merged', requisito_id = r.id, resuelto_en = now()
     where id = p_aporte_id;
  end if;
  return jsonb_build_object('id', r.id, 'slug', r.slug, 'version', r.version + 1);
end;
$$;

-- ─────────────────────────────────────────────────── aportes
create function public.db_public_requirements_srv_registrar_aporte(
  p_autor text, p_texto text, p_categorias text[])
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  if coalesce(p_autor, '') = '' then raise exception 'hace falta una cuenta'; end if;
  -- Segundo cerrojo, por si api/ se equivocara: el tope diario por persona.
  if (select count(*) from db_public_requirements.aporte
       where autor = p_autor and creado_en > now() - interval '1 day') >= 30 then
    raise exception 'demasiados aportes hoy';
  end if;
  insert into db_public_requirements.aporte (autor, texto, categorias_sugeridas)
  values (p_autor, trim(p_texto), coalesce(p_categorias, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.db_public_requirements_srv_resolver_aporte(
  p_id bigint, p_estado text, p_veredicto jsonb, p_requisito_id bigint default null)
returns void language sql volatile security definer set search_path = '' as $$
  update db_public_requirements.aporte
     set estado = p_estado, veredicto = p_veredicto,
         requisito_id = coalesce(p_requisito_id, requisito_id), resuelto_en = now()
   where id = p_id
$$;

create function public.db_public_requirements_srv_mis_aportes(p_sub text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'text', a.texto, 'status', a.estado, 'verdict', a.veredicto,
           'requirement', r.slug, 'created_at', a.creado_en)
         order by a.creado_en desc), '[]'::jsonb)
    from (select * from db_public_requirements.aporte
           where autor = p_sub order by creado_en desc limit 100) a
    left join db_public_requirements.requisito r on r.id = a.requisito_id
$$;

-- ─────────────────────────────────────────────────── API keys
create function public.db_public_requirements_srv_crear_key(
  p_sub text, p_nombre text, p_prefijo text, p_hash text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  if coalesce(p_sub, '') = '' then raise exception 'hace falta una cuenta'; end if;
  if length(coalesce(p_hash, '')) <> 64 then raise exception 'hash inválido'; end if;
  if (select count(*) from db_public_requirements.api_key
       where duenyo = p_sub and revocada_en is null) >= 5 then
    raise exception 'máximo 5 keys activas';
  end if;
  insert into db_public_requirements.api_key (duenyo, prefijo, hash, nombre)
  values (p_sub, p_prefijo, p_hash, left(trim(p_nombre), 60))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create function public.db_public_requirements_srv_listar_keys(p_sub text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id, 'name', k.nombre, 'prefix', k.prefijo, 'created_at', k.creada_en,
           'last_used', k.ultimo_uso, 'revoked', k.revocada_en is not null)
         order by k.creada_en desc), '[]'::jsonb)
    from db_public_requirements.api_key k where k.duenyo = p_sub
$$;

create function public.db_public_requirements_srv_revocar_key(p_sub text, p_id bigint)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  update db_public_requirements.api_key set revocada_en = now()
   where id = p_id and duenyo = p_sub and revocada_en is null;
  return found;
end;
$$;

-- Devuelve el dueño si la key existe y no está revocada. Anota el último uso
-- como mucho una vez por minuto, para no escribir en cada lectura.
create function public.db_public_requirements_srv_key_por_hash(p_hash text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare k db_public_requirements.api_key;
begin
  select * into k from db_public_requirements.api_key
   where hash = p_hash and revocada_en is null;
  if not found then return null; end if;
  if k.ultimo_uso is null or k.ultimo_uso < now() - interval '1 minute' then
    update db_public_requirements.api_key set ultimo_uso = now() where id = k.id;
  end if;
  return jsonb_build_object('id', k.id, 'owner', k.duenyo);
end;
$$;

-- ─────────────────────────────────────────────────── RGPD
-- Borra las keys y los aportes de la persona; lo que ya está publicado como
-- requisito se queda (CC BY 4.0) pero sin su identidad.
create function public.db_public_requirements_srv_borrar_mis_datos(p_sub text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_keys int; v_aportes int; v_req int;
begin
  if coalesce(p_sub, '') = '' then raise exception 'hace falta una cuenta'; end if;
  update db_public_requirements.requisito set autor = null where autor = p_sub;
  get diagnostics v_req = row_count;
  delete from db_public_requirements.api_key where duenyo = p_sub;
  get diagnostics v_keys = row_count;
  delete from db_public_requirements.aporte where autor = p_sub;
  get diagnostics v_aportes = row_count;
  return jsonb_build_object('keys', v_keys, 'contributions', v_aportes, 'anonymised', v_req);
end;
$$;

-- ─────────────────────────────────────────────────── permisos
-- Postgres da EXECUTE a PUBLIC en toda función nueva y Supabase además a anon y
-- authenticated. Se quita todo y solo service_role (api/) conserva la puerta.
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
alter table db_public_requirements.categoria          enable row level security;
alter table db_public_requirements.requisito          enable row level security;
alter table db_public_requirements.requisito_categoria enable row level security;
alter table db_public_requirements.aporte             enable row level security;
alter table db_public_requirements.requisito_version  enable row level security;
alter table db_public_requirements.api_key            enable row level security;
alter table db_public_requirements.cupo               enable row level security;
alter table db_public_requirements.embedding_consulta enable row level security;
