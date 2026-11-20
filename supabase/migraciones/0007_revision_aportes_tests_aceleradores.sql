-- ════════════════════════════════════════════════════════════════════════════
--  0007 · revisión de aportes de TESTS y ACELERADORES (además de requisitos)
--
--  · aporte: ahora lleva el tipo (requirement | test | accelerator), la propuesta
--    estructurada tal como la envió la persona y el test/acelerador que creó o
--    fusionó.
--  · similares de tests y de aceleradores por embedding (como srv_similares).
--  · fusionar test / acelerador: añade enlaces a requisitos y mejora el texto, pero
--    NUNCA cambia una prioridad ni una cobertura que ya existan (lo decide una persona).
--  · acelerador_por_url: la misma URL no se publica dos veces.
--
--  Mismo contrato de siempre: solo service_role, security definer, search_path fijo.
-- ════════════════════════════════════════════════════════════════════════════

alter table db_public_requirements.aporte
  add column tipo text not null default 'requirement'
    check (tipo in ('requirement', 'test', 'accelerator')),
  add column propuesta jsonb check (propuesta is null or length(propuesta::text) <= 12000),
  add column test_id bigint references db_public_requirements.test (id) on delete set null,
  add column acelerador_id bigint references db_public_requirements.acelerador (id) on delete set null;

-- ─────────────────────────────────────────────────── registrar y enlazar aportes
create function public.db_public_requirements_srv_registrar_propuesta(
  p_autor text, p_tipo text, p_texto text, p_propuesta jsonb, p_categorias text[])
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_id bigint;
begin
  if coalesce(p_autor, '') = '' then raise exception 'hace falta una cuenta'; end if;
  if p_tipo not in ('requirement', 'test', 'accelerator') then raise exception 'tipo de aporte inválido'; end if;
  -- Segundo cerrojo, por si api/ se equivocara: el tope diario por persona.
  if (select count(*) from db_public_requirements.aporte
       where autor = p_autor and creado_en > now() - interval '1 day') >= 30 then
    raise exception 'demasiados aportes hoy';
  end if;
  insert into db_public_requirements.aporte (autor, tipo, texto, propuesta, categorias_sugeridas)
  values (p_autor, p_tipo, trim(p_texto), p_propuesta, coalesce(p_categorias, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.db_public_requirements_srv_enlazar_aporte(
  p_id bigint, p_tipo text, p_item_id bigint)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_tipo = 'test' then
    update db_public_requirements.aporte set test_id = p_item_id where id = p_id;
  elsif p_tipo = 'accelerator' then
    update db_public_requirements.aporte set acelerador_id = p_item_id where id = p_id;
  elsif p_tipo = 'requirement' then
    update db_public_requirements.aporte set requisito_id = p_item_id where id = p_id;
  else
    raise exception 'tipo de aporte inválido';
  end if;
end;
$$;

create or replace function public.db_public_requirements_srv_mis_aportes(p_sub text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'type', a.tipo, 'text', a.texto, 'status', a.estado, 'verdict', a.veredicto,
           'requirement', r.slug, 'test', t.slug, 'accelerator', c.slug,
           'created_at', a.creado_en)
         order by a.creado_en desc), '[]'::jsonb)
    from (select * from db_public_requirements.aporte
           where autor = p_sub order by creado_en desc limit 100) a
    left join db_public_requirements.requisito r on r.id = a.requisito_id
    left join db_public_requirements.test t on t.id = a.test_id
    left join db_public_requirements.acelerador c on c.id = a.acelerador_id
$$;

-- ─────────────────────────────────────────────────── similares por embedding
create function public.db_public_requirements_srv_similares_tests(p_vec text, p_n int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.d), '[]'::jsonb)
    from (select db_public_requirements.ficha_test(t.id)
                   || jsonb_build_object('id', t.id,
                        'similarity', round((1 - (t.embedding operator(extensions.<=>)
                                                  p_vec::extensions.vector))::numeric, 4)) as j,
                 t.embedding operator(extensions.<=>) p_vec::extensions.vector as d
            from db_public_requirements.test t
           where t.estado = 'published' and t.embedding is not null
           order by d
           limit least(greatest(coalesce(p_n, 5), 1), 20)) x
$$;

create function public.db_public_requirements_srv_similares_aceleradores(p_vec text, p_n int)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.d), '[]'::jsonb)
    from (select db_public_requirements.ficha_acelerador(a.id)
                   || jsonb_build_object('id', a.id,
                        'similarity', round((1 - (a.embedding operator(extensions.<=>)
                                                  p_vec::extensions.vector))::numeric, 4)) as j,
                 a.embedding operator(extensions.<=>) p_vec::extensions.vector as d
            from db_public_requirements.acelerador a
           where a.estado = 'published' and a.embedding is not null
           order by d
           limit least(greatest(coalesce(p_n, 5), 1), 20)) x
$$;

-- Ficha del acelerador publicado con esa misma URL (sin barra final ni mayúsculas), o null.
create function public.db_public_requirements_srv_acelerador_por_url(p_url text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select db_public_requirements.ficha_acelerador(a.id)
         || jsonb_build_object('id', a.id, 'similarity', 1)
    from db_public_requirements.acelerador a
   where a.estado = 'published'
     and lower(regexp_replace(a.url, '/+$', '')) = lower(regexp_replace(trim(p_url), '/+$', ''))
   limit 1
$$;

-- ─────────────────────────────────────────────────── fusionar
-- Mejora el texto del test y añade enlaces a requisitos. La prioridad, el tipo y los
-- enlaces que ya tiene no se tocan: eso lo decide una persona.
create function public.db_public_requirements_srv_fusionar_test(
  p_test_id bigint, p_titulo text, p_escenario text, p_requisitos text[],
  p_vec text, p_aporte_id bigint default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare t db_public_requirements.test; s text; v_req bigint;
begin
  select * into t from db_public_requirements.test
   where id = p_test_id and estado = 'published' for update;
  if not found then raise exception 'el test no existe'; end if;

  update db_public_requirements.test
     set titulo = trim(p_titulo), escenario = trim(p_escenario),
         embedding = coalesce(nullif(p_vec, '')::extensions.vector, embedding),
         actualizado_en = now()
   where id = t.id;

  foreach s in array coalesce(p_requisitos, '{}') loop
    select id into v_req from db_public_requirements.requisito where slug = s and estado = 'published';
    if not found then raise exception 'el requisito % no existe', s; end if;
    insert into db_public_requirements.test_requisito (test_id, requisito_id)
    values (t.id, v_req) on conflict do nothing;
  end loop;
  if (select count(*) from db_public_requirements.test_requisito where test_id = t.id) > 8 then
    raise exception 'un test se relaciona con entre 1 y 8 requisitos';
  end if;

  if p_aporte_id is not null then
    update db_public_requirements.aporte
       set estado = 'merged', test_id = t.id, resuelto_en = now()
     where id = p_aporte_id;
  end if;
  return jsonb_build_object('id', t.id, 'slug', t.slug);
end;
$$;

-- p_requisitos: [{"slug": "...", "coverage": "full" | "partial"}, …]. Los enlaces que ya
-- existen conservan su cobertura; las plataformas se suman.
create function public.db_public_requirements_srv_fusionar_acelerador(
  p_acelerador_id bigint, p_descripcion text, p_plataformas text[], p_requisitos jsonb,
  p_vec text, p_aporte_id bigint default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a db_public_requirements.acelerador; c jsonb; v_req bigint;
begin
  select * into a from db_public_requirements.acelerador
   where id = p_acelerador_id and estado = 'published' for update;
  if not found then raise exception 'el acelerador no existe'; end if;

  update db_public_requirements.acelerador
     set descripcion = trim(p_descripcion),
         plataformas = (select coalesce(array_agg(distinct x), '{}')
                          from unnest(plataformas || coalesce(p_plataformas, '{}')) x),
         embedding = coalesce(nullif(p_vec, '')::extensions.vector, embedding),
         actualizado_en = now()
   where id = a.id;

  if p_requisitos is not null and jsonb_typeof(p_requisitos) = 'array' then
    for c in select * from jsonb_array_elements(p_requisitos) loop
      select id into v_req from db_public_requirements.requisito
       where slug = c->>'slug' and estado = 'published';
      if not found then raise exception 'el requisito % no existe', c->>'slug'; end if;
      insert into db_public_requirements.acelerador_requisito (acelerador_id, requisito_id, cobertura)
      values (a.id, v_req, coalesce(c->>'coverage', 'partial')) on conflict do nothing;
    end loop;
  end if;
  if (select count(*) from db_public_requirements.acelerador_requisito where acelerador_id = a.id) > 20 then
    raise exception 'un acelerador se relaciona con entre 1 y 20 requisitos';
  end if;

  if p_aporte_id is not null then
    update db_public_requirements.aporte
       set estado = 'merged', acelerador_id = a.id, resuelto_en = now()
     where id = p_aporte_id;
  end if;
  return jsonb_build_object('id', a.id, 'slug', a.slug);
end;
$$;

-- permisos (idempotente)
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
