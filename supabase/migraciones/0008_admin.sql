-- ════════════════════════════════════════════════════════════════════════════
--  0008 · zona admin / cuadro de control
--
--  Tablas nuevas (RLS activo, sin políticas, como todas):
--    actividad_diaria     contadores por día y métrica (lecturas, búsquedas, copias, errores…).
--                         Retención de 1 AÑO (la tabla `cupo` solo guarda 2 días). Se alimenta por
--                         lotes desde la API (srv_registrar_eventos), no una escritura por petición.
--    auditoria            quién (hash corto del sub, nunca el sub) hizo qué acción que cambia datos.
--    propuesta_division   propuestas de la IA para partir un requisito demasiado largo; quedan
--                         guardadas y las acepta o descarta una persona.
--
--  Todo lo demás del cuadro de control se DERIVA de tablas que ya existen (aportes, sugerencias,
--  claves, proyectos, requisitos): no hay que contarlo aparte.
--  Funciones: public.db_public_requirements_srv_admin_* y srv_registrar_eventos (solo service_role).
--  Los sub de otras personas salen SIEMPRE como hash corto con sal (p_sal, la pone la API).
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────── tablas
create table db_public_requirements.actividad_diaria (
  dia     date   not null default current_date,
  metrica text   not null check (metrica ~ '^[a-z0-9_]{2,30}$'),
  n       bigint not null default 0 check (n >= 0),
  primary key (dia, metrica)
);

create table db_public_requirements.auditoria (
  id       bigserial primary key,
  cuando   timestamptz not null default now(),
  admin    text not null,                      -- hash corto del sub del admin
  accion   text not null check (length(accion) between 2 and 60),
  objetivo text,
  detalle  jsonb not null default '{}'::jsonb
);
create index on db_public_requirements.auditoria (cuando);

create table db_public_requirements.propuesta_division (
  id           bigserial primary key,
  requisito_id bigint not null references db_public_requirements.requisito (id) on delete cascade,
  estado       text not null default 'pending' check (estado in ('pending', 'accepted', 'dismissed')),
  partes       jsonb not null check (jsonb_typeof(partes) = 'array' and jsonb_array_length(partes) between 2 and 4),
  motivo       text not null default '' check (length(motivo) <= 600),
  puntuacion   int,
  modelo       text,
  creada_en    timestamptz not null default now(),
  resuelta_en  timestamptz,
  resultado    jsonb
);
-- como mucho UNA propuesta pendiente por requisito
create unique index propuesta_division_pendiente on db_public_requirements.propuesta_division (requisito_id)
  where estado = 'pending';

alter table db_public_requirements.actividad_diaria   enable row level security;
alter table db_public_requirements.auditoria          enable row level security;
alter table db_public_requirements.propuesta_division enable row level security;

-- ─────────────────────────────────────────────────── ayudas internas
create function db_public_requirements.hash_corto(p_sub text, p_sal text)
returns text language sql immutable set search_path = '' as $$
  select case when p_sub is null then null
              else left(encode(sha256(convert_to(coalesce(p_sal, '') || p_sub, 'UTF8')), 'hex'), 10) end
$$;

create function db_public_requirements.auditar(p_admin text, p_accion text, p_objetivo text, p_detalle jsonb)
returns void language sql volatile set search_path = '' as $$
  insert into db_public_requirements.auditoria (admin, accion, objetivo, detalle)
  values (left(coalesce(p_admin, '?'), 20), left(p_accion, 60), left(p_objetivo, 200), coalesce(p_detalle, '{}'::jsonb))
$$;

-- ─────────────────────────────────────────────────── actividad
-- p_eventos = {"read": 12, "search": 3, …}. Suma al día de hoy. Pensada para llamarse por lotes.
create function public.db_public_requirements_srv_registrar_eventos(p_eventos jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare k text; v jsonb; n bigint; hechos int := 0;
begin
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'object' then return; end if;
  for k, v in select * from jsonb_each(p_eventos) loop
    exit when hechos >= 20;
    continue when k !~ '^[a-z0-9_]{2,30}$' or jsonb_typeof(v) <> 'number';
    n := least(greatest((v #>> '{}')::numeric, 0), 1000000)::bigint;
    continue when n = 0;
    insert into db_public_requirements.actividad_diaria (dia, metrica, n) values (current_date, k, n)
    on conflict (dia, metrica) do update set n = db_public_requirements.actividad_diaria.n + excluded.n;
    hechos := hechos + 1;
  end loop;
  -- limpieza oportunista: 1 año de retención
  if random() < 0.01 then
    delete from db_public_requirements.actividad_diaria where dia < current_date - 366;
    delete from db_public_requirements.auditoria where cuando < now() - interval '366 days';
  end if;
end;
$$;

-- Serie diaria de los últimos p_dias: contadores propios + lo que se deriva de las tablas existentes.
create function public.db_public_requirements_srv_admin_actividad(p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dias int := least(greatest(coalesce(p_dias, 30), 1), 365); v_res jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.dia,
           'counters', coalesce((select jsonb_object_agg(a.metrica, a.n) from db_public_requirements.actividad_diaria a
                                  where a.dia = d.dia), '{}'::jsonb),
           'contributions', coalesce((select jsonb_object_agg(q.estado, q.n)
                                        from (select ap.estado, count(*) as n from db_public_requirements.aporte ap
                                               where ap.creado_en >= d.dia and ap.creado_en < d.dia + 1
                                               group by ap.estado) q), '{}'::jsonb),
           'suggestions', (select count(*) from db_public_requirements.sugerencia s
                            where s.creada_en >= d.dia and s.creada_en < d.dia + 1),
           'keys_created', (select count(*) from db_public_requirements.api_key k
                             where k.creada_en >= d.dia and k.creada_en < d.dia + 1),
           'projects_created', (select count(*) from db_public_requirements.proyecto p
                                 where p.creado_en >= d.dia and p.creado_en < d.dia + 1),
           'requirements_created', (select count(*) from db_public_requirements.requisito r
                                     where r.creado_en >= d.dia and r.creado_en < d.dia + 1))
         order by d.dia), '[]'::jsonb)
    into v_res
    from generate_series(current_date - (v_dias - 1), current_date, interval '1 day') g
    cross join lateral (select g::date as dia) d;
  return v_res;
end;
$$;

-- ─────────────────────────────────────────────────── resumen y estado de la base
create function public.db_public_requirements_srv_admin_resumen()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tablas jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', t.relname, 'rows', t.filas, 'bytes', t.bytes) order by t.bytes desc), '[]'::jsonb)
    into v_tablas
    from (select c.relname, pg_total_relation_size(c.oid) as bytes,
                 (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as filas
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'db_public_requirements' and c.relkind = 'r') t;

  return jsonb_build_object(
    'requirements', jsonb_build_object(
      'published', (select count(*) from db_public_requirements.requisito where estado = 'published'),
      'archived',  (select count(*) from db_public_requirements.requisito where estado = 'archived')),
    'tests',        (select count(*) from db_public_requirements.test where estado = 'published'),
    'accelerators', (select count(*) from db_public_requirements.acelerador where estado = 'published'),
    'categories',   (select count(*) from db_public_requirements.categoria),
    'copies_total', (select coalesce(sum(copias), 0) from db_public_requirements.requisito),
    'contributions', coalesce((select jsonb_object_agg(estado, n) from
                                 (select estado, count(*) as n from db_public_requirements.aporte group by estado) q), '{}'::jsonb),
    'suggestions',   coalesce((select jsonb_object_agg(estado, n) from
                                 (select estado, count(*) as n from db_public_requirements.sugerencia group by estado) q), '{}'::jsonb),
    'proposals_pending', (select count(*) from db_public_requirements.propuesta_division where estado = 'pending'),
    'keys_active', (select count(*) from db_public_requirements.api_key where revocada_en is null),
    'projects',    (select count(*) from db_public_requirements.proyecto),
    'database_bytes', pg_database_size(current_database()),
    'tables', v_tablas);
end;
$$;

-- ─────────────────────────────────────────────────── aportes (línea de tiempo y cola)
-- Filtros: estado, requisito (slug) y persona (hash corto). Paginación por id descendente.
create function public.db_public_requirements_srv_admin_aportes(
  p_estado text, p_requisito text, p_quien text, p_sal text, p_limite int default 50, p_antes bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_lim int := least(greatest(coalesce(p_limite, 50), 1), 100); v_res jsonb; v_mas boolean; v_min bigint;
begin
  with f as (
    select a.*, r.slug as r_slug
      from db_public_requirements.aporte a
      left join db_public_requirements.requisito r on r.id = a.requisito_id
     where (nullif(p_estado, '') is null or a.estado = p_estado)
       and (nullif(p_requisito, '') is null or r.slug = p_requisito)
       and (nullif(p_quien, '') is null or db_public_requirements.hash_corto(a.autor, p_sal) = p_quien)
       and (p_antes is null or a.id < p_antes)
     order by a.id desc
     limit v_lim + 1),
  pag as (select * from f order by id desc limit v_lim)
  select coalesce((select jsonb_agg(jsonb_build_object(
           'id', x.id, 'status', x.estado, 'who', db_public_requirements.hash_corto(x.autor, p_sal),
           'text', left(x.texto, 700), 'categories', to_jsonb(x.categorias_sugeridas),
           'verdict', x.veredicto, 'requirement', x.r_slug,
           'created_at', x.creado_en, 'resolved_at', x.resuelto_en) order by x.id desc) from pag x), '[]'::jsonb),
         (select count(*) from f) > v_lim,
         (select min(id) from pag)
    into v_res, v_mas, v_min;
  return jsonb_build_object('items', v_res, 'next', case when v_mas then v_min end);
end;
$$;

-- Toma un aporte en needs_human y lo deja en 'pending' (cerrojo: dos admins no lo resuelven a la vez).
-- Devuelve lo que hace falta para aprobarlo, INCLUIDO el autor en claro (solo viaja al servidor).
create function public.db_public_requirements_srv_admin_aporte_reclamar(p_id bigint)
returns jsonb language sql volatile security definer set search_path = '' as $$
  update db_public_requirements.aporte
     set estado = 'pending'
   where id = p_id and estado = 'needs_human'
  returning jsonb_build_object('id', id, 'author', autor, 'text', texto, 'verdict', veredicto,
                               'categories', to_jsonb(categorias_sugeridas))
$$;

create function public.db_public_requirements_srv_admin_auditar(p_admin text, p_accion text, p_objetivo text, p_detalle jsonb)
returns void language sql volatile security definer set search_path = '' as $$
  select db_public_requirements.auditar(p_admin, p_accion, p_objetivo, p_detalle)
$$;

create function public.db_public_requirements_srv_admin_auditoria(p_limite int default 50)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.cuando, 'admin', x.admin, 'action', x.accion,
                                               'target', x.objetivo, 'detail', x.detalle) order by x.id desc), '[]'::jsonb)
    from (select * from db_public_requirements.auditoria order by id desc
           limit least(greatest(coalesce(p_limite, 50), 1), 200)) x
$$;

-- ─────────────────────────────────────────────────── sugerencias
create function public.db_public_requirements_srv_admin_sugerencias(
  p_estado text, p_sal text, p_limite int default 50, p_antes bigint default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'status', x.estado, 'kind', x.tipo, 'target_type', x.objetivo_tipo, 'target', x.objetivo_slug,
           'text', x.texto, 'who', db_public_requirements.hash_corto(x.autor, p_sal), 'created_at', x.creada_en)
         order by x.id desc), '[]'::jsonb)
    from (select * from db_public_requirements.sugerencia s
           where (nullif(p_estado, '') is null or s.estado = p_estado)
             and (p_antes is null or s.id < p_antes)
           order by s.id desc
           limit least(greatest(coalesce(p_limite, 50), 1), 100)) x
$$;

create function public.db_public_requirements_srv_admin_sugerencia_estado(p_id bigint, p_estado text, p_admin text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_antes text;
begin
  if p_estado not in ('new', 'accepted', 'dismissed') then raise exception 'estado inválido'; end if;
  select estado into v_antes from db_public_requirements.sugerencia where id = p_id for update;
  if not found then return false; end if;
  update db_public_requirements.sugerencia set estado = p_estado where id = p_id;
  perform db_public_requirements.auditar(p_admin, 'suggestion_status', 'suggestion:' || p_id,
            jsonb_build_object('from', v_antes, 'to', p_estado));
  return true;
end;
$$;

-- ─────────────────────────────────────────────────── historial de un requisito
create function public.db_public_requirements_srv_admin_versiones(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'slug', r.slug, 'status', r.estado,
    'current', jsonb_build_object('version', r.version, 'title', r.titulo, 'statement', r.enunciado,
                                  'criteria', r.criterios, 'updated_at', r.actualizado_en),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'title', v.titulo,
                            'statement', v.enunciado, 'criteria', v.criterios, 'contribution', v.aporte_id,
                            'created_at', v.creado_en) order by v.version desc)
                            from db_public_requirements.requisito_version v where v.requisito_id = r.id), '[]'::jsonb))
    from db_public_requirements.requisito r where r.slug = p_slug
$$;

-- ─────────────────────────────────────────────────── requisitos largos / partibles
-- Devuelve las métricas en bruto de los más voluminosos; la puntuación de «candidato a partir» la
-- calcula la API (lib/partible.mjs, pura y con tests). El corte es holgado a propósito.
create function public.db_public_requirements_srv_admin_candidatos(p_limite int default 300)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', x.slug, 'title', x.titulo, 'statement', x.enunciado,
           'criteria_count', x.n_criterios, 'categories_count', x.n_cats,
           'tests_count', x.n_tests, 'accelerators_count', x.n_acel,
           'copies', x.copias, 'version', x.version,
           'proposal', x.propuesta) order by x.peso desc), '[]'::jsonb)
    from (select r.slug, r.titulo, r.enunciado, r.copias, r.version,
                 jsonb_array_length(r.criterios) as n_criterios,
                 (select count(*) from db_public_requirements.requisito_categoria c where c.requisito_id = r.id) as n_cats,
                 (select count(*) from db_public_requirements.test_requisito t where t.requisito_id = r.id) as n_tests,
                 (select count(*) from db_public_requirements.acelerador_requisito a where a.requisito_id = r.id) as n_acel,
                 (select p.id from db_public_requirements.propuesta_division p
                   where p.requisito_id = r.id and p.estado = 'pending') as propuesta,
                 length(r.enunciado) + 60 * jsonb_array_length(r.criterios) as peso
            from db_public_requirements.requisito r
           where r.estado = 'published'
           order by peso desc
           limit least(greatest(coalesce(p_limite, 300), 1), 600)) x
$$;

-- Un requisito completo (cualquier estado) con su id, para pedirle a la IA que lo divida.
create function public.db_public_requirements_srv_admin_requisito(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select db_public_requirements.ficha(r.id) || jsonb_build_object('id', r.id, 'status', r.estado)
    from db_public_requirements.requisito r where r.slug = p_slug
$$;

-- ─────────────────────────────────────────────────── propuestas de división
-- p_partes = [{"title","statement","criteria":[…]}, …] (2 a 4). No se aplica nada: queda guardada.
-- Si ya había una pendiente de ese requisito, se sustituye.
create function public.db_public_requirements_srv_admin_propuesta_crear(
  p_slug text, p_partes jsonb, p_motivo text, p_puntuacion int, p_modelo text, p_admin text)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_req bigint; v_id bigint; v_n int;
begin
  select id into v_req from db_public_requirements.requisito where slug = p_slug and estado = 'published';
  if not found then raise exception 'el requisito no existe'; end if;
  if p_partes is null or jsonb_typeof(p_partes) <> 'array' then raise exception 'partes inválidas'; end if;
  v_n := jsonb_array_length(p_partes);
  if v_n not between 2 and 4 then raise exception 'hacen falta de 2 a 4 partes'; end if;
  delete from db_public_requirements.propuesta_division where requisito_id = v_req and estado = 'pending';
  insert into db_public_requirements.propuesta_division (requisito_id, partes, motivo, puntuacion, modelo)
  values (v_req, p_partes, left(coalesce(p_motivo, ''), 600), p_puntuacion, left(p_modelo, 60))
  returning id into v_id;
  perform db_public_requirements.auditar(p_admin, 'split_proposed', 'requirement:' || p_slug,
            jsonb_build_object('proposal', v_id, 'parts', v_n));
  return v_id;
end;
$$;

create function public.db_public_requirements_srv_admin_propuestas(p_estado text default 'pending', p_limite int default 50)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'status', x.estado, 'requirement', x.slug, 'title', x.titulo, 'statement', x.enunciado,
           'parts', x.partes, 'reason', x.motivo, 'score', x.puntuacion, 'model', x.modelo,
           'created_at', x.creada_en, 'resolved_at', x.resuelta_en, 'result', x.resultado) order by x.id desc), '[]'::jsonb)
    from (select p.*, r.slug, r.titulo, r.enunciado
            from db_public_requirements.propuesta_division p
            join db_public_requirements.requisito r on r.id = p.requisito_id
           where nullif(p_estado, '') is null or p.estado = p_estado
           order by p.id desc
           limit least(greatest(coalesce(p_limite, 50), 1), 100)) x
$$;

create function public.db_public_requirements_srv_admin_propuesta_descartar(p_id bigint, p_admin text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  update db_public_requirements.propuesta_division set estado = 'dismissed', resuelta_en = now()
   where id = p_id and estado = 'pending';
  if not found then return false; end if;
  perform db_public_requirements.auditar(p_admin, 'split_dismissed', 'proposal:' || p_id, '{}'::jsonb);
  return true;
end;
$$;

-- Aceptar: crea las partes (con las categorías y PRIORIDADES del original), les enlaza los tests y
-- aceleradores del original y archiva el original. Todo en una transacción.
-- p_vecs = ["[0.1,…]", null, …] (un embedding por parte, o null).
create function public.db_public_requirements_srv_admin_propuesta_aceptar(p_id bigint, p_vecs jsonb, p_admin text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  p db_public_requirements.propuesta_division; o db_public_requirements.requisito;
  v_cats jsonb; v_parte jsonb; v_i int := 0; v_nuevo jsonb; v_slugs text[] := '{}'; v_ids bigint[] := '{}';
begin
  select * into p from db_public_requirements.propuesta_division where id = p_id and estado = 'pending' for update;
  if not found then raise exception 'la propuesta no existe o ya está resuelta'; end if;
  select * into o from db_public_requirements.requisito where id = p.requisito_id and estado = 'published' for update;
  if not found then raise exception 'el requisito ya no está publicado'; end if;

  select jsonb_agg(jsonb_build_object('slug', c.categoria_slug, 'priority', c.prioridad)) into v_cats
    from db_public_requirements.requisito_categoria c where c.requisito_id = o.id;

  for v_parte in select * from jsonb_array_elements(p.partes) loop
    v_nuevo := public.db_public_requirements_srv_crear_requisito(
      v_parte->>'title', v_parte->>'statement', coalesce(v_parte->'criteria', '[]'::jsonb), o.clase,
      v_cats, nullif(p_vecs->>v_i, ''), o.autor, null, null);
    v_slugs := v_slugs || (v_nuevo->>'slug');
    v_ids := v_ids || (v_nuevo->>'id')::bigint;
    v_i := v_i + 1;
  end loop;

  insert into db_public_requirements.test_requisito (test_id, requisito_id)
  select t.test_id, n from db_public_requirements.test_requisito t cross join unnest(v_ids) n
   where t.requisito_id = o.id on conflict do nothing;
  insert into db_public_requirements.acelerador_requisito (acelerador_id, requisito_id, cobertura)
  select a.acelerador_id, n, 'partial' from db_public_requirements.acelerador_requisito a cross join unnest(v_ids) n
   where a.requisito_id = o.id on conflict do nothing;

  update db_public_requirements.requisito set estado = 'archived' where id = o.id;
  update db_public_requirements.propuesta_division
     set estado = 'accepted', resuelta_en = now(),
         resultado = jsonb_build_object('created', to_jsonb(v_slugs), 'archived', o.slug)
   where id = p.id;
  perform db_public_requirements.auditar(p_admin, 'split_accepted', 'requirement:' || o.slug,
            jsonb_build_object('proposal', p.id, 'created', to_jsonb(v_slugs)));
  return jsonb_build_object('created', to_jsonb(v_slugs), 'archived', o.slug);
end;
$$;

-- ─────────────────────────────────────────────────── paneles baratos
create function public.db_public_requirements_srv_admin_paneles()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'top_copied', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'title', x.titulo, 'copies', x.copias) order by x.copias desc, x.id)
                              from (select * from db_public_requirements.requisito
                                     where estado = 'published' and copias > 0 order by copias desc, id limit 20) x), '[]'::jsonb),
    'without_tests', jsonb_build_object(
      'count', (select count(*) from db_public_requirements.requisito r where r.estado = 'published'
                   and not exists (select 1 from db_public_requirements.test_requisito t where t.requisito_id = r.id)),
      'items', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'title', x.titulo, 'copies', x.copias) order by x.copias desc, x.id)
                           from (select r.* from db_public_requirements.requisito r where r.estado = 'published'
                                    and not exists (select 1 from db_public_requirements.test_requisito t where t.requisito_id = r.id)
                                  order by r.copias desc, r.id limit 50) x), '[]'::jsonb)),
    'without_accelerators', jsonb_build_object(
      'count', (select count(*) from db_public_requirements.requisito r where r.estado = 'published'
                   and not exists (select 1 from db_public_requirements.acelerador_requisito a where a.requisito_id = r.id)),
      'items', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'title', x.titulo, 'copies', x.copias) order by x.copias desc, x.id)
                           from (select r.* from db_public_requirements.requisito r where r.estado = 'published'
                                    and not exists (select 1 from db_public_requirements.acelerador_requisito a where a.requisito_id = r.id)
                                  order by r.copias desc, r.id limit 50) x), '[]'::jsonb)),
    'empty_categories', jsonb_build_object(
      'count', (select count(*) from db_public_requirements.categoria c
                 where c.tipo in ('app_type', 'software_category', 'screen_type', 'cross_cutting')
                   and not exists (select 1 from db_public_requirements.requisito_categoria rc
                                     join db_public_requirements.requisito r on r.id = rc.requisito_id and r.estado = 'published'
                                    where rc.categoria_slug = c.slug)),
      'items', coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'name', x.nombre, 'type', x.tipo) order by x.tipo, x.orden, x.nombre)
                           from (select c.* from db_public_requirements.categoria c
                                  where c.tipo in ('app_type', 'software_category', 'screen_type', 'cross_cutting')
                                    and not exists (select 1 from db_public_requirements.requisito_categoria rc
                                                      join db_public_requirements.requisito r on r.id = rc.requisito_id and r.estado = 'published'
                                                     where rc.categoria_slug = c.slug)
                                  order by c.tipo, c.orden, c.nombre limit 100) x), '[]'::jsonb)))
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
