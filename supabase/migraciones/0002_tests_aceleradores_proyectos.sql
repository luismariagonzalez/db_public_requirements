-- ════════════════════════════════════════════════════════════════════════════
--  0002 · tests, aceleradores, proyectos y sugerencias
--
--  · test: cómo comprobar que un requisito se cumple. Se relaciona con uno o
--    más requisitos y tiene su propia prioridad 1-5.
--  · acelerador: librería open source, propietaria o SaaS que ahorra tiempo al
--    implementar uno o más requisitos.
--  · proyecto: lo crea una persona con cuenta para llevar la cuenta de qué
--    requisitos, tests y aceleradores ha implementado (o tiene pendientes).
--  · sugerencia: cualquier persona con cuenta o API key propone algo.
--
--  Mismo contrato que 0001: nada para anon/authenticated, RLS sin políticas,
--  funciones public.db_public_requirements_srv_* solo para service_role.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────── tablas
create table db_public_requirements.test (
  id             bigserial primary key,
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{3,119}$'),
  titulo         text not null check (length(titulo) between 5 and 120),
  escenario      text not null check (length(escenario) between 10 and 800),
  tipo           text not null check (tipo in ('unit', 'integration', 'e2e', 'security',
                   'performance', 'accessibility', 'manual')),
  prioridad      smallint not null check (prioridad between 1 and 5),
  embedding      extensions.vector(768),
  fts            tsvector generated always as
                   (to_tsvector('english', titulo || ' ' || escenario)) stored,
  estado         text not null default 'published' check (estado in ('published', 'archived')),
  autor          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index on db_public_requirements.test using gin (fts);
create index on db_public_requirements.test using hnsw (embedding extensions.vector_cosine_ops);

create table db_public_requirements.test_requisito (
  test_id      bigint not null references db_public_requirements.test (id) on delete cascade,
  requisito_id bigint not null references db_public_requirements.requisito (id) on delete cascade,
  primary key (test_id, requisito_id)
);
create index on db_public_requirements.test_requisito (requisito_id);

create table db_public_requirements.acelerador (
  id             bigserial primary key,
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,119}$'),
  nombre         text not null check (length(nombre) between 2 and 80),
  descripcion    text not null check (length(descripcion) between 10 and 600),
  modelo         text not null check (modelo in ('open_source', 'proprietary', 'saas')),
  coste          text not null check (coste in ('free', 'freemium', 'paid')),
  url            text not null check (url ~ '^https://[^[:space:]]+$' and length(url) <= 300),
  plataformas    text[] not null default '{}' check (cardinality(plataformas) <= 12),
  embedding      extensions.vector(768),
  fts            tsvector generated always as
                   (to_tsvector('english', nombre || ' ' || descripcion)) stored,
  estado         text not null default 'published' check (estado in ('published', 'archived')),
  autor          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index on db_public_requirements.acelerador using gin (fts);
create index on db_public_requirements.acelerador using hnsw (embedding extensions.vector_cosine_ops);

create table db_public_requirements.acelerador_requisito (
  acelerador_id bigint not null references db_public_requirements.acelerador (id) on delete cascade,
  requisito_id  bigint not null references db_public_requirements.requisito (id) on delete cascade,
  cobertura     text not null default 'partial' check (cobertura in ('full', 'partial')),
  primary key (acelerador_id, requisito_id)
);
create index on db_public_requirements.acelerador_requisito (requisito_id);

create table db_public_requirements.proyecto (
  id             bigserial primary key,
  duenyo         text not null,
  nombre         text not null check (length(nombre) between 1 and 80),
  descripcion    text not null default '' check (length(descripcion) <= 500),
  categorias     text[] not null default '{}' check (cardinality(categorias) <= 12),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index on db_public_requirements.proyecto (duenyo, lower(nombre));

-- item_id es polimórfico (requisito, test o acelerador): sin clave foránea; la
-- función que escribe comprueba que existe.
create table db_public_requirements.proyecto_item (
  proyecto_id    bigint not null references db_public_requirements.proyecto (id) on delete cascade,
  tipo           text   not null check (tipo in ('requirement', 'test', 'accelerator')),
  item_id        bigint not null,
  estado         text   not null check (estado in ('planned', 'in_progress', 'done', 'skipped')),
  nota           text   not null default '' check (length(nota) <= 300),
  actualizado_en timestamptz not null default now(),
  primary key (proyecto_id, tipo, item_id)
);

create table db_public_requirements.sugerencia (
  id            bigserial primary key,
  autor         text not null,
  tipo          text not null check (tipo in ('new_item', 'improvement', 'report')),
  objetivo_tipo text not null check (objetivo_tipo in ('requirement', 'test', 'accelerator', 'general')),
  objetivo_slug text,
  texto         text not null check (length(texto) between 10 and 1500),
  estado        text not null default 'new' check (estado in ('new', 'accepted', 'dismissed')),
  creada_en     timestamptz not null default now()
);
create index on db_public_requirements.sugerencia (autor, creada_en);

-- ─────────────────────────────────────────────────── fichas internas
create function db_public_requirements.ficha_test(p_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', t.slug, 'title', t.titulo, 'scenario', t.escenario,
    'type', t.tipo, 'priority', t.prioridad,
    'requirements', coalesce((select jsonb_agg(r.slug order by r.slug)
                                from db_public_requirements.test_requisito tr
                                join db_public_requirements.requisito r on r.id = tr.requisito_id
                               where tr.test_id = t.id and r.estado = 'published'), '[]'::jsonb))
  from db_public_requirements.test t where t.id = p_id
$$;

create function db_public_requirements.ficha_acelerador(p_id bigint)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slug', a.slug, 'name', a.nombre, 'description', a.descripcion,
    'model', a.modelo, 'cost', a.coste, 'url', a.url, 'platforms', to_jsonb(a.plataformas),
    'requirements', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'coverage', ar.cobertura)
                                               order by r.slug)
                                from db_public_requirements.acelerador_requisito ar
                                join db_public_requirements.requisito r on r.id = ar.requisito_id
                               where ar.acelerador_id = a.id and r.estado = 'published'), '[]'::jsonb))
  from db_public_requirements.acelerador a where a.id = p_id
$$;

-- ─────────────────────────────────────────────────── lectura: tests
create function public.db_public_requirements_srv_test(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select db_public_requirements.ficha_test(t.id)
    from db_public_requirements.test t where t.slug = p_slug and t.estado = 'published'
$$;

create function public.db_public_requirements_srv_buscar_tests(
  p_vec text, p_texto text, p_categorias text[], p_prioridad_max int,
  p_tipos text[], p_limite int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q   extensions.vector := case when nullif(p_vec, '') is null then null else p_vec::extensions.vector end;
  v_tsq tsquery := case when nullif(trim(coalesce(p_texto, '')), '') is null then null
                        else websearch_to_tsquery('english', p_texto) end;
  v_res jsonb;
begin
  if v_tsq is not null and numnode(v_tsq) = 0 then v_tsq := null; end if;

  with filtro as (
    select t.id, t.prioridad as prio
      from db_public_requirements.test t
     where t.estado = 'published'
       and t.prioridad <= coalesce(p_prioridad_max, 5)
       and (coalesce(cardinality(p_tipos), 0) = 0 or t.tipo = any (p_tipos))
       and (coalesce(cardinality(p_categorias), 0) = 0 or exists (
              select 1 from db_public_requirements.test_requisito tr
                join db_public_requirements.requisito_categoria rc on rc.requisito_id = tr.requisito_id
               where tr.test_id = t.id and rc.categoria_slug = any (p_categorias)))
  ),
  vec as (
    select x.id, row_number() over (order by x.d) as rk
      from (select f.id, t.embedding operator(extensions.<=>) v_q as d
              from filtro f join db_public_requirements.test t on t.id = f.id
             where v_q is not null and t.embedding is not null order by d limit 60) x
  ),
  txt as (
    select y.id, row_number() over (order by y.s desc) as rk
      from (select f.id, ts_rank_cd(t.fts, v_tsq) as s
              from filtro f join db_public_requirements.test t on t.id = f.id
             where v_tsq is not null and t.fts @@ v_tsq order by s desc limit 60) y
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
  select coalesce(jsonb_agg(db_public_requirements.ficha_test(k.id) order by k.score desc, k.prio, k.id), '[]'::jsonb)
    into v_res from clasif k;
  return v_res;
end;
$$;

-- ─────────────────────────────────────────────────── lectura: aceleradores
create function public.db_public_requirements_srv_acelerador(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select db_public_requirements.ficha_acelerador(a.id)
    from db_public_requirements.acelerador a where a.slug = p_slug and a.estado = 'published'
$$;

create function public.db_public_requirements_srv_buscar_aceleradores(
  p_vec text, p_texto text, p_categorias text[], p_modelos text[],
  p_plataformas text[], p_limite int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q   extensions.vector := case when nullif(p_vec, '') is null then null else p_vec::extensions.vector end;
  v_tsq tsquery := case when nullif(trim(coalesce(p_texto, '')), '') is null then null
                        else websearch_to_tsquery('english', p_texto) end;
  v_res jsonb;
begin
  if v_tsq is not null and numnode(v_tsq) = 0 then v_tsq := null; end if;

  with filtro as (
    select a.id,
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
    select f.id, f.n,
           coalesce(1.0 / (60 + vec.rk), 0) + coalesce(1.0 / (60 + txt.rk), 0) as score
      from filtro f
      left join vec on vec.id = f.id
      left join txt on txt.id = f.id
     where (v_q is null and v_tsq is null) or vec.id is not null or txt.id is not null
     order by score desc, f.n desc, f.id
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
  )
  select coalesce(jsonb_agg(db_public_requirements.ficha_acelerador(k.id) order by k.score desc, k.n desc, k.id), '[]'::jsonb)
    into v_res from clasif k;
  return v_res;
end;
$$;

-- Lo relacionado con un conjunto de requisitos, para pedirlos juntos:
-- { "<slug>": { "tests": [...], "accelerators": [...] } }
create function public.db_public_requirements_srv_relacionados(
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
                                              'cost', a.coste, 'url', a.url, 'coverage', ar.cobertura)
                           order by ar.cobertura, a.nombre)
            from db_public_requirements.acelerador_requisito ar
            join db_public_requirements.acelerador a on a.id = ar.acelerador_id
           where ar.requisito_id = r.id and a.estado = 'published'), '[]'::jsonb) else '[]'::jsonb end
    )), '{}'::jsonb)
    from db_public_requirements.requisito r
   where r.slug = any (p_slugs) and r.estado = 'published');
end;
$$;

-- ─────────────────────────────────────────────────── escritura de contenido
-- Con p_slug (la semilla) es idempotente: si ya existe, no toca nada.
create function public.db_public_requirements_srv_crear_test(
  p_titulo text, p_escenario text, p_tipo text, p_prioridad int, p_requisitos text[],
  p_vec text, p_autor text default null, p_slug text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint; v_slug text; v_base text; v_n int := 1; s text; v_req bigint;
begin
  if coalesce(cardinality(p_requisitos), 0) not between 1 and 8 then
    raise exception 'un test se relaciona con entre 1 y 8 requisitos';
  end if;
  if nullif(p_slug, '') is not null then
    select id into v_id from db_public_requirements.test where slug = p_slug;
    if found then return jsonb_build_object('id', v_id, 'slug', p_slug, 'created', false); end if;
    v_slug := p_slug;
  else
    v_base := db_public_requirements.slugify(p_titulo); v_slug := v_base;
    while exists (select 1 from db_public_requirements.test where slug = v_slug) loop
      v_n := v_n + 1; v_slug := v_base || '-' || v_n;
    end loop;
  end if;

  insert into db_public_requirements.test (slug, titulo, escenario, tipo, prioridad, embedding, autor)
  values (v_slug, trim(p_titulo), trim(p_escenario), p_tipo, p_prioridad::smallint,
          nullif(p_vec, '')::extensions.vector, p_autor)
  returning id into v_id;

  foreach s in array p_requisitos loop
    select id into v_req from db_public_requirements.requisito where slug = s and estado = 'published';
    if not found then raise exception 'el requisito % no existe', s; end if;
    insert into db_public_requirements.test_requisito (test_id, requisito_id)
    values (v_id, v_req) on conflict do nothing;
  end loop;
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'created', true);
end;
$$;

-- p_requisitos: [{"slug": "...", "coverage": "full" | "partial"}, …]
create function public.db_public_requirements_srv_crear_acelerador(
  p_nombre text, p_descripcion text, p_modelo text, p_coste text, p_url text,
  p_plataformas text[], p_requisitos jsonb, p_vec text,
  p_autor text default null, p_slug text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint; v_slug text; v_base text; v_n int := 1; c jsonb; v_req bigint;
begin
  if p_requisitos is null or jsonb_typeof(p_requisitos) <> 'array'
     or jsonb_array_length(p_requisitos) not between 1 and 20 then
    raise exception 'un acelerador se relaciona con entre 1 y 20 requisitos';
  end if;
  if nullif(p_slug, '') is not null then
    select id into v_id from db_public_requirements.acelerador where slug = p_slug;
    if found then return jsonb_build_object('id', v_id, 'slug', p_slug, 'created', false); end if;
    v_slug := p_slug;
  else
    v_base := db_public_requirements.slugify(p_nombre); v_slug := v_base;
    while exists (select 1 from db_public_requirements.acelerador where slug = v_slug) loop
      v_n := v_n + 1; v_slug := v_base || '-' || v_n;
    end loop;
  end if;

  insert into db_public_requirements.acelerador
    (slug, nombre, descripcion, modelo, coste, url, plataformas, embedding, autor)
  values (v_slug, trim(p_nombre), trim(p_descripcion), p_modelo, p_coste, trim(p_url),
          coalesce(p_plataformas, '{}'), nullif(p_vec, '')::extensions.vector, p_autor)
  returning id into v_id;

  for c in select * from jsonb_array_elements(p_requisitos) loop
    select id into v_req from db_public_requirements.requisito
     where slug = c->>'slug' and estado = 'published';
    if not found then raise exception 'el requisito % no existe', c->>'slug'; end if;
    insert into db_public_requirements.acelerador_requisito (acelerador_id, requisito_id, cobertura)
    values (v_id, v_req, coalesce(c->>'coverage', 'partial')) on conflict do nothing;
  end loop;
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'created', true);
end;
$$;

-- ─────────────────────────────────────────────────── proyectos
create function public.db_public_requirements_srv_crear_proyecto(
  p_sub text, p_nombre text, p_descripcion text, p_categorias text[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  if coalesce(p_sub, '') = '' then raise exception 'hace falta una cuenta'; end if;
  if (select count(*) from db_public_requirements.proyecto where duenyo = p_sub) >= 20 then
    raise exception 'máximo 20 proyectos';
  end if;
  insert into db_public_requirements.proyecto (duenyo, nombre, descripcion, categorias)
  values (p_sub, trim(p_nombre), coalesce(trim(p_descripcion), ''), coalesce(p_categorias, '{}'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', trim(p_nombre));
exception when unique_violation then
  raise exception 'ya tienes un proyecto con ese nombre';
end;
$$;

create function public.db_public_requirements_srv_listar_proyectos(p_sub text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.nombre, 'description', p.descripcion, 'categories', to_jsonb(p.categorias),
    'counts', jsonb_build_object(
      'planned',     (select count(*) from db_public_requirements.proyecto_item i where i.proyecto_id = p.id and i.estado = 'planned'),
      'in_progress', (select count(*) from db_public_requirements.proyecto_item i where i.proyecto_id = p.id and i.estado = 'in_progress'),
      'done',        (select count(*) from db_public_requirements.proyecto_item i where i.proyecto_id = p.id and i.estado = 'done'),
      'skipped',     (select count(*) from db_public_requirements.proyecto_item i where i.proyecto_id = p.id and i.estado = 'skipped')),
    'updated_at', p.actualizado_en) order by p.actualizado_en desc), '[]'::jsonb)
  from db_public_requirements.proyecto p where p.duenyo = p_sub
$$;

-- null si no existe o no es suyo (no se distingue, para no revelar ids ajenos)
create function public.db_public_requirements_srv_proyecto(p_sub text, p_id bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.nombre, 'description', p.descripcion, 'categories', to_jsonb(p.categorias),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('type', x.tipo, 'slug', x.slug, 'title', x.titulo,
                                          'status', x.estado, 'note', x.nota)
                       order by x.estado, x.tipo, x.titulo)
        from (select i.tipo, i.estado, i.nota,
                     case i.tipo when 'requirement' then r.slug when 'test' then t.slug else a.slug end as slug,
                     case i.tipo when 'requirement' then r.titulo when 'test' then t.titulo else a.nombre end as titulo
                from db_public_requirements.proyecto_item i
                left join db_public_requirements.requisito r on i.tipo = 'requirement' and r.id = i.item_id
                left join db_public_requirements.test t on i.tipo = 'test' and t.id = i.item_id
                left join db_public_requirements.acelerador a on i.tipo = 'accelerator' and a.id = i.item_id
               where i.proyecto_id = p.id) x), '[]'::jsonb))
  from db_public_requirements.proyecto p where p.id = p_id and p.duenyo = p_sub
$$;

-- { "requirement:<slug>": "done", "test:<slug>": "planned", … } para anotar búsquedas.
create function public.db_public_requirements_srv_estados_proyecto(p_sub text, p_id bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select (select coalesce(jsonb_object_agg(
            x.tipo || ':' || x.slug, x.estado) filter (where x.slug is not null), '{}'::jsonb)
            from (select i.tipo, i.estado,
                         case i.tipo when 'requirement' then r.slug when 'test' then t.slug else a.slug end as slug
                    from db_public_requirements.proyecto_item i
                    left join db_public_requirements.requisito r on i.tipo = 'requirement' and r.id = i.item_id
                    left join db_public_requirements.test t on i.tipo = 'test' and t.id = i.item_id
                    left join db_public_requirements.acelerador a on i.tipo = 'accelerator' and a.id = i.item_id
                   where i.proyecto_id = p.id) x)
    from db_public_requirements.proyecto p where p.id = p_id and p.duenyo = p_sub
$$;

-- p_items: [{"type": "requirement", "slug": "…", "status": "done", "note": "…"}, …]
-- Los slugs que no existen no abortan: se devuelven en "unknown".
create function public.db_public_requirements_srv_marcar_items(p_sub text, p_id bigint, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare e jsonb; v_item bigint; v_n int := 0; v_desconocidos jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from db_public_requirements.proyecto where id = p_id and duenyo = p_sub) then
    raise exception 'proyecto no encontrado';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'items: entre 1 y 200';
  end if;
  if (select count(*) from db_public_requirements.proyecto_item where proyecto_id = p_id) > 2000 then
    raise exception 'el proyecto tiene demasiados items';
  end if;

  for e in select * from jsonb_array_elements(p_items) loop
    if e->>'status' not in ('planned', 'in_progress', 'done', 'skipped') then
      raise exception 'estado inválido: %', e->>'status';
    end if;
    v_item := case e->>'type'
      when 'requirement' then (select id from db_public_requirements.requisito where slug = e->>'slug' and estado = 'published')
      when 'test'        then (select id from db_public_requirements.test where slug = e->>'slug' and estado = 'published')
      when 'accelerator' then (select id from db_public_requirements.acelerador where slug = e->>'slug' and estado = 'published')
      else null end;
    if e->>'type' not in ('requirement', 'test', 'accelerator') then
      raise exception 'tipo inválido: %', e->>'type';
    end if;
    if v_item is null then
      v_desconocidos := v_desconocidos || to_jsonb((e->>'type') || ':' || coalesce(e->>'slug', ''));
      continue;
    end if;
    insert into db_public_requirements.proyecto_item (proyecto_id, tipo, item_id, estado, nota)
    values (p_id, e->>'type', v_item, e->>'status', left(coalesce(e->>'note', ''), 300))
    on conflict (proyecto_id, tipo, item_id) do update
      set estado = excluded.estado,
          nota = case when e ? 'note' then excluded.nota else db_public_requirements.proyecto_item.nota end,
          actualizado_en = now();
    v_n := v_n + 1;
  end loop;

  update db_public_requirements.proyecto set actualizado_en = now() where id = p_id;
  return jsonb_build_object('updated', v_n, 'unknown', v_desconocidos);
end;
$$;

create function public.db_public_requirements_srv_borrar_proyecto(p_sub text, p_id bigint)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from db_public_requirements.proyecto where id = p_id and duenyo = p_sub;
  return found;
end;
$$;

-- ─────────────────────────────────────────────────── sugerencias
create function public.db_public_requirements_srv_sugerir(
  p_autor text, p_tipo text, p_objetivo_tipo text, p_objetivo_slug text, p_texto text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint; v_existe boolean := true;
begin
  if coalesce(p_autor, '') = '' then raise exception 'hace falta una cuenta'; end if;
  if (select count(*) from db_public_requirements.sugerencia
       where autor = p_autor and creada_en > now() - interval '1 day') >= 20 then
    raise exception 'demasiadas sugerencias hoy';
  end if;
  if nullif(p_objetivo_slug, '') is not null then
    v_existe := case p_objetivo_tipo
      when 'requirement' then exists (select 1 from db_public_requirements.requisito where slug = p_objetivo_slug)
      when 'test'        then exists (select 1 from db_public_requirements.test where slug = p_objetivo_slug)
      when 'accelerator' then exists (select 1 from db_public_requirements.acelerador where slug = p_objetivo_slug)
      else false end;
    if not v_existe then raise exception 'el objetivo no existe'; end if;
  end if;
  insert into db_public_requirements.sugerencia (autor, tipo, objetivo_tipo, objetivo_slug, texto)
  values (p_autor, p_tipo, p_objetivo_tipo, nullif(p_objetivo_slug, ''), trim(p_texto))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.db_public_requirements_srv_mis_sugerencias(p_sub text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'kind', s.tipo, 'target_type', s.objetivo_tipo, 'target', s.objetivo_slug,
           'text', s.texto, 'status', s.estado, 'created_at', s.creada_en)
         order by s.creada_en desc), '[]'::jsonb)
    from (select * from db_public_requirements.sugerencia where autor = p_sub
           order by creada_en desc limit 100) s
$$;

-- ─────────────────────────────────────────────────── RGPD (sustituye a la de 0001)
create or replace function public.db_public_requirements_srv_borrar_mis_datos(p_sub text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_keys int; v_aportes int; v_req int; v_proy int; v_sug int;
begin
  if coalesce(p_sub, '') = '' then raise exception 'hace falta una cuenta'; end if;
  update db_public_requirements.requisito   set autor = null where autor = p_sub;
  get diagnostics v_req = row_count;
  update db_public_requirements.test        set autor = null where autor = p_sub;
  update db_public_requirements.acelerador  set autor = null where autor = p_sub;
  delete from db_public_requirements.api_key    where duenyo = p_sub;
  get diagnostics v_keys = row_count;
  delete from db_public_requirements.aporte     where autor = p_sub;
  get diagnostics v_aportes = row_count;
  delete from db_public_requirements.proyecto   where duenyo = p_sub;   -- sus items caen en cascada
  get diagnostics v_proy = row_count;
  delete from db_public_requirements.sugerencia where autor = p_sub;
  get diagnostics v_sug = row_count;
  return jsonb_build_object('keys', v_keys, 'contributions', v_aportes, 'anonymised', v_req,
                            'projects', v_proy, 'suggestions', v_sug);
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
alter table db_public_requirements.test                 enable row level security;
alter table db_public_requirements.test_requisito       enable row level security;
alter table db_public_requirements.acelerador           enable row level security;
alter table db_public_requirements.acelerador_requisito enable row level security;
alter table db_public_requirements.proyecto             enable row level security;
alter table db_public_requirements.proyecto_item        enable row level security;
alter table db_public_requirements.sugerencia           enable row level security;
