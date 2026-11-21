-- ════════════════════════════════════════════════════════════════════════════
--  0006 · embeddings con todas las etiquetas y mapa 2D de requisitos
--
--  1. `requisito.embedding_v` dice con qué formato de texto se calculó el vector:
--       1 = título + enunciado (el de antes)
--       2 = título + enunciado + criterios + clase + todas las categorías (lib/texto_embedding.mjs)
--     Los requisitos existentes quedan en 1; los nuevos nacen en 2 (el código ya calcula así su vector).
--     `scripts/reembeber.mjs` los recalcula por lotes con estas funciones (UNA vez tras desplegar).
--  2. El mapa: coordenadas 2D por requisito (`mapa_requisito`) y el modelo de proyección que las
--     produjo (`mapa_modelo`, una fila). Las calcula `scripts/mapa_calcular.mjs`, no la petición.
--     `GET /api/v1/map` lee `srv_mapa()`.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────── 1. versión del texto del embedding
alter table db_public_requirements.requisito add column embedding_v smallint not null default 1;
alter table db_public_requirements.requisito alter column embedding_v set default 2;

-- Lo que falta por reembeber (texto antiguo o sin vector): fichas completas (con categorías) para componer el texto.
-- Paginado por id (p_despues) para poder reanudar; `pending` cuenta todo lo pendiente.
create function public.db_public_requirements_srv_requisitos_para_embeber(
  p_version int default 2, p_despues bigint default 0, p_limite int default 50)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pending', (select count(*) from db_public_requirements.requisito
                 where estado = 'published' and (embedding_v < p_version or embedding is null)),
    'items', coalesce((select jsonb_agg(db_public_requirements.ficha(x.id) || jsonb_build_object('id', x.id) order by x.id)
                         from (select r.id from db_public_requirements.requisito r
                                where r.estado = 'published' and (r.embedding_v < p_version or r.embedding is null) and r.id > coalesce(p_despues, 0)
                                order by r.id
                                limit least(greatest(coalesce(p_limite, 50), 1), 200)) x), '[]'::jsonb))
$$;

-- Guarda un vector nuevo y la versión del texto con que se calculó. No cuenta como edición.
create function public.db_public_requirements_srv_guardar_embedding(p_id bigint, p_vec text, p_version int default 2)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform set_config('reqdb.sin_fechas', '1', true);
  update db_public_requirements.requisito
     set embedding = p_vec::extensions.vector, embedding_v = p_version
   where id = p_id;
end;
$$;

-- ─────────────────────────────────────────────────── 2. el mapa
create table db_public_requirements.mapa_requisito (
  requisito_id bigint primary key references db_public_requirements.requisito (id) on delete cascade,
  x            real not null check (x between -10 and 10),
  y            real not null check (y between -10 and 10),
  calculado_en timestamptz not null default now()
);
alter table db_public_requirements.mapa_requisito enable row level security;

-- Una sola fila: el modelo de proyección (media, ejes, escala) con el que se hicieron las coordenadas.
create table db_public_requirements.mapa_modelo (
  id            smallint primary key check (id = 1),
  modelo        jsonb not null,
  actualizado_en timestamptz not null default now()
);
alter table db_public_requirements.mapa_modelo enable row level security;

-- Vectores para (re)calcular el mapa, paginados por id. p_solo_nuevos: solo los que aún no tienen coordenadas.
create function public.db_public_requirements_srv_mapa_para_calcular(
  p_despues bigint default 0, p_limite int default 100, p_solo_nuevos boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', (select count(*) from db_public_requirements.requisito r
               where r.estado = 'published' and r.embedding is not null
                 and (not coalesce(p_solo_nuevos, false)
                      or not exists (select 1 from db_public_requirements.mapa_requisito m where m.requisito_id = r.id))),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'vec', x.v::text) order by x.id)
                         from (select r.id, r.embedding as v from db_public_requirements.requisito r
                                where r.estado = 'published' and r.embedding is not null and r.id > coalesce(p_despues, 0)
                                  and (not coalesce(p_solo_nuevos, false)
                                       or not exists (select 1 from db_public_requirements.mapa_requisito m where m.requisito_id = r.id))
                                order by r.id
                                limit least(greatest(coalesce(p_limite, 100), 1), 200)) x), '[]'::jsonb))
$$;

create function public.db_public_requirements_srv_mapa_modelo()
returns jsonb language sql stable security definer set search_path = '' as $$
  select modelo from db_public_requirements.mapa_modelo where id = 1
$$;

-- p_puntos: [{"id": 1, "x": 0.12, "y": -0.4}, …]. p_modelo (opcional) se guarda como el modelo vigente.
-- Quita las coordenadas de lo que ya no se publica o no tiene vector. Devuelve cuántos puntos se escribieron.
create function public.db_public_requirements_srv_guardar_mapa(p_puntos jsonb, p_modelo jsonb default null)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  if p_puntos is null or jsonb_typeof(p_puntos) <> 'array' or jsonb_array_length(p_puntos) > 500 then
    raise exception 'p_puntos: un array de hasta 500 puntos';
  end if;

  insert into db_public_requirements.mapa_requisito (requisito_id, x, y)
  select (p->>'id')::bigint, (p->>'x')::real, (p->>'y')::real
    from jsonb_array_elements(p_puntos) p
   where exists (select 1 from db_public_requirements.requisito r where r.id = (p->>'id')::bigint)
  on conflict (requisito_id) do update set x = excluded.x, y = excluded.y, calculado_en = now();
  get diagnostics v_n = row_count;

  if p_modelo is not null then
    insert into db_public_requirements.mapa_modelo (id, modelo) values (1, p_modelo)
    on conflict (id) do update set modelo = excluded.modelo, actualizado_en = now();
  end if;

  delete from db_public_requirements.mapa_requisito m
   where not exists (select 1 from db_public_requirements.requisito r
                      where r.id = m.requisito_id and r.estado = 'published' and r.embedding is not null);
  return v_n;
end;
$$;

-- Lo que sirve GET /api/v1/map: un punto por requisito publicado con coordenadas, sin enunciados.
--   app_type: el tipo de app de mejor prioridad (o, si solo cuelga de categorías de software, el primer
--             arquetipo que heredan); topics: sus transversales.
create function public.db_public_requirements_srv_mapa()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'count', count(*),
    'generated_at', max(m.calculado_en),
    'points', coalesce(jsonb_agg(jsonb_build_object(
      'slug', r.slug,
      'title', r.titulo,
      'x', m.x,
      'y', m.y,
      'priority', (select min(rc.prioridad) from db_public_requirements.requisito_categoria rc where rc.requisito_id = r.id),
      'kind', r.clase,
      'app_type', coalesce(
        (select rc.categoria_slug
           from db_public_requirements.requisito_categoria rc
           join db_public_requirements.categoria c on c.slug = rc.categoria_slug and c.tipo = 'app_type'
          where rc.requisito_id = r.id
          order by rc.prioridad, rc.categoria_slug limit 1),
        (select u.a
           from db_public_requirements.requisito_categoria rc
           join db_public_requirements.categoria c on c.slug = rc.categoria_slug and c.tipo = 'software_category'
          cross join lateral unnest(c.arquetipos) with ordinality u (a, i)
          where rc.requisito_id = r.id
          order by rc.prioridad, c.slug, u.i limit 1)),
      'topics', coalesce((select jsonb_agg(rc.categoria_slug order by rc.categoria_slug)
                            from db_public_requirements.requisito_categoria rc
                            join db_public_requirements.categoria c on c.slug = rc.categoria_slug and c.tipo = 'cross_cutting'
                           where rc.requisito_id = r.id), '[]'::jsonb),
      'copies', r.copias) order by r.id), '[]'::jsonb))
    from db_public_requirements.mapa_requisito m
    join db_public_requirements.requisito r on r.id = m.requisito_id
   where r.estado = 'published'
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
