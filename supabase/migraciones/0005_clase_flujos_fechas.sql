-- ════════════════════════════════════════════════════════════════════════════
--  0005 · clase funcional/técnico, acceso en tres flujos y fechas que se mantienen solas
--
--  1. `clase` pasa de 9 valores a 2 (functional | technical). El tema (seguridad,
--     privacidad, accesibilidad…) vive solo en las categorías transversales.
--     Regla fija aquí; el repaso fino lo hace `srv_reorganizar` con lo que decida Gemini.
--  2. `screen-auth` se reparte en flow-sign-up / flow-sign-in / flow-recovery (los tres,
--     con su prioridad) y se retira. `srv_reorganizar` deja a cada requisito solo en los
--     flujos que le corresponden.
--  3. `actualizado_en` se mantiene solo (requisitos, tests y aceleradores) cuando cambia
--     el CONTENIDO, no al sumar copias. Solo se guarda: la API no lo filtra ni lo ordena.
--
--  Los datos de la reorganización (qué clase tiene cada requisito, qué flujos, qué
--  arquetipos hereda cada categoría) NO van aquí: los genera scripts/reorganizar.mjs y se
--  aplican con `srv_reorganizar(p_datos)`. Así el repositorio público no lleva contenido.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────── 1. clase
update db_public_requirements.requisito
   set clase = case when clase in ('technical', 'performance', 'reliability') then 'technical' else 'functional' end
 where clase not in ('functional', 'technical');

alter table db_public_requirements.requisito drop constraint requisito_clase_check;
alter table db_public_requirements.requisito
  add constraint requisito_clase_check check (clase in ('functional', 'technical'));

-- ─────────────────────────────────────────────────── 2. screen-auth → tres flujos
insert into db_public_requirements.requisito_categoria (requisito_id, categoria_slug, prioridad)
select rc.requisito_id, f.slug, rc.prioridad
  from db_public_requirements.requisito_categoria rc
 cross join (values ('flow-sign-up'), ('flow-sign-in'), ('flow-recovery')) f (slug)
 where rc.categoria_slug = 'screen-auth'
on conflict do nothing;

update db_public_requirements.proyecto
   set categorias = (select (array_agg(distinct x))[1:12]
                       from unnest(array_remove(categorias, 'screen-auth')
                                   || array['flow-sign-up', 'flow-sign-in', 'flow-recovery']) x)
 where 'screen-auth' = any (categorias);
update db_public_requirements.aporte
   set categorias_sugeridas = array_remove(categorias_sugeridas, 'screen-auth')
 where 'screen-auth' = any (categorias_sugeridas);

delete from db_public_requirements.categoria where slug = 'screen-auth';

-- ─────────────────────────────────────────────────── repaso fino: srv_reorganizar
-- p_datos = {
--   "clases":        { "<slug-requisito>": "functional" | "technical" },
--   "acceso":        { "<slug-requisito>": ["flow-sign-in", …] },        -- exactamente estos flujos de acceso
--   "transversales": [ { "slug": "<requisito>", "categoria": "<transversal>", "prioridad": 1-5 } ],
--   "herencia":      { "<categoria-de-software>": ["<arquetipo>", …] }   -- como mucho 3
-- }
-- Idempotente. No toca las fechas de actualización: es una reorganización, no una edición.
create function public.db_public_requirements_srv_reorganizar(p_datos jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_clases int := 0; v_acceso int := 0; v_transv int := 0; v_herencia int := 0;
  k text; v jsonb; r bigint; p int; t jsonb;
  flujos constant text[] := array['flow-sign-up', 'flow-sign-in', 'flow-recovery'];
begin
  perform set_config('reqdb.sin_fechas', '1', true);

  for k, v in select * from jsonb_each(coalesce(p_datos->'clases', '{}'::jsonb)) loop
    if v #>> '{}' in ('functional', 'technical') then
      update db_public_requirements.requisito set clase = v #>> '{}' where slug = k and clase <> v #>> '{}';
      if found then v_clases := v_clases + 1; end if;
    end if;
  end loop;

  for k, v in select * from jsonb_each(coalesce(p_datos->'acceso', '{}'::jsonb)) loop
    select id into r from db_public_requirements.requisito where slug = k;
    continue when r is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0;
    select min(prioridad) into p from db_public_requirements.requisito_categoria
     where requisito_id = r and categoria_slug = any (flujos);
    continue when p is null;
    delete from db_public_requirements.requisito_categoria where requisito_id = r and categoria_slug = any (flujos);
    insert into db_public_requirements.requisito_categoria (requisito_id, categoria_slug, prioridad)
    select r, f, p from jsonb_array_elements_text(v) f where f = any (flujos)
    on conflict do nothing;
    v_acceso := v_acceso + 1;
  end loop;

  for t in select * from jsonb_array_elements(coalesce(p_datos->'transversales', '[]'::jsonb)) loop
    insert into db_public_requirements.requisito_categoria (requisito_id, categoria_slug, prioridad)
    select r2.id, c.slug, (t->>'prioridad')::int
      from db_public_requirements.requisito r2, db_public_requirements.categoria c
     where r2.slug = t->>'slug' and c.slug = t->>'categoria' and c.tipo = 'cross_cutting'
       and (t->>'prioridad')::int between 1 and 5
    on conflict do nothing;
    if found then v_transv := v_transv + 1; end if;
  end loop;

  for k, v in select * from jsonb_each(coalesce(p_datos->'herencia', '{}'::jsonb)) loop
    continue when jsonb_typeof(v) <> 'array';
    update db_public_requirements.categoria c
       set arquetipos = coalesce((select array_agg(a) from (select distinct a from jsonb_array_elements_text(v) a
                                    where exists (select 1 from db_public_requirements.categoria x where x.slug = a and x.tipo = 'app_type')
                                    limit 3) q), '{}')
     where c.slug = k and c.tipo = 'software_category';
    if found then v_herencia := v_herencia + 1; end if;
  end loop;

  return jsonb_build_object('clases', v_clases, 'acceso', v_acceso, 'transversales', v_transv, 'herencia', v_herencia);
end;
$$;

-- ─────────────────────────────────────────────────── 3. fechas que se mantienen solas
-- Se crean al FINAL, así los cambios de arriba no marcan nada como «cambiado».
-- Una función por tabla: en PL/pgSQL, mirar un campo que la tabla no tiene falla aunque la rama no se use.
create function db_public_requirements.tocar_fecha_requisito() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('reqdb.sin_fechas', true), '') <> '1'
     and (new.titulo, new.enunciado, new.criterios, new.clase, new.estado)
         is distinct from (old.titulo, old.enunciado, old.criterios, old.clase, old.estado) then
    new.actualizado_en := now();
  end if;
  return new;
end;
$$;

create function db_public_requirements.tocar_fecha_test() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('reqdb.sin_fechas', true), '') <> '1'
     and (new.titulo, new.escenario, new.tipo, new.prioridad, new.estado)
         is distinct from (old.titulo, old.escenario, old.tipo, old.prioridad, old.estado) then
    new.actualizado_en := now();
  end if;
  return new;
end;
$$;

create function db_public_requirements.tocar_fecha_acelerador() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('reqdb.sin_fechas', true), '') <> '1'
     and (new.nombre, new.descripcion, new.url, new.modelo, new.coste, new.plataformas, new.estado)
         is distinct from (old.nombre, old.descripcion, old.url, old.modelo, old.coste, old.plataformas, old.estado) then
    new.actualizado_en := now();
  end if;
  return new;
end;
$$;

create trigger fecha_requisito before update on db_public_requirements.requisito
  for each row execute function db_public_requirements.tocar_fecha_requisito();
create trigger fecha_test before update on db_public_requirements.test
  for each row execute function db_public_requirements.tocar_fecha_test();
create trigger fecha_acelerador before update on db_public_requirements.acelerador
  for each row execute function db_public_requirements.tocar_fecha_acelerador();

-- Una prioridad nueva, un test o un acelerador enlazado también son un cambio del requisito.
create function db_public_requirements.tocar_requisito() returns trigger
language plpgsql set search_path = '' as $$
declare v_id bigint := coalesce(new.requisito_id, old.requisito_id);
begin
  if coalesce(current_setting('reqdb.sin_fechas', true), '') <> '1' then
    update db_public_requirements.requisito set actualizado_en = now() where id = v_id;
  end if;
  return null;
end;
$$;

create trigger fecha_requisito_categoria after insert or update or delete on db_public_requirements.requisito_categoria
  for each row execute function db_public_requirements.tocar_requisito();
create trigger fecha_test_requisito after insert or update or delete on db_public_requirements.test_requisito
  for each row execute function db_public_requirements.tocar_requisito();
create trigger fecha_acelerador_requisito after insert or update or delete on db_public_requirements.acelerador_requisito
  for each row execute function db_public_requirements.tocar_requisito();

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
