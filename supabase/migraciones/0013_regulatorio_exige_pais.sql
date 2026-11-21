-- ════════════════════════════════════════════════════════════════════════════
-- 0013 · Lo regulatorio exige país también en las búsquedas sin «qué construyes»
--
-- La 0012 ya exigía `country` para lo regulatorio (requisitos con jurisdicción) cuando solo
-- se pedían transversales o flujos. Faltaba el caso sin categorías (solo texto, o nada):
-- «user account» devolvía primero requisitos del juego regulado de España y Colombia.
-- Ahora un requisito con jurisdicción solo sale si se pide un país o si se pide algún tipo de
-- app o categoría de software (y, por la regla de alcance de la 0012, ha de ser el suyo).
--
-- Misma firma y misma respuesta que la 0012 ({total, items}): `create or replace`, sin corte.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.db_public_requirements_srv_buscar(
  p_vec text, p_texto text, p_categorias text[], p_prioridad_max int,
  p_clases text[], p_limite int, p_orden text default null,
  p_paises text[] default null, p_solo_pais boolean default false, p_desde int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q   extensions.vector := case when nullif(p_vec, '') is null then null
                                  else p_vec::extensions.vector end;
  v_tsq tsquery := case when nullif(trim(coalesce(p_texto, '')), '') is null then null
                        else websearch_to_tsquery('english', p_texto) end;
  v_orden text;
  v_hay_cats boolean := coalesce(cardinality(p_categorias), 0) > 0;
  v_hay_pais boolean := coalesce(cardinality(p_paises), 0) > 0;
  v_construye boolean;
  v_limite int := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_desde int := least(greatest(coalesce(p_desde, 0), 0), 10000);
  v_res jsonb;
begin
  if v_tsq is not null and numnode(v_tsq) = 0 then v_tsq := null; end if;
  v_orden := coalesce(nullif(p_orden, ''), case when v_q is null and v_tsq is null then 'priority' else 'relevance' end);
  if v_orden not in ('priority', 'copies', 'relevance') then
    raise exception 'orden desconocido: %', v_orden;
  end if;
  -- ¿se ha pedido algún «qué construyes» (tipo de app o categoría de software)?
  select exists (select 1 from db_public_requirements.categoria c
                  where c.slug = any (coalesce(p_categorias, '{}')) and c.tipo in ('app_type', 'software_category'))
    into v_construye;

  with filtro as (
    select r.id, r.copias, min(rc.prioridad) as prio
      from db_public_requirements.requisito r
      join db_public_requirements.requisito_categoria rc on rc.requisito_id = r.id
     where r.estado = 'published'
       and (not v_hay_cats or rc.categoria_slug = any (p_categorias))
       and (coalesce(cardinality(p_clases), 0) = 0 or r.clase = any (p_clases))
       -- país: aplica si está asociado a alguno de los pedidos; los genéricos (sin ninguna
       -- asociación) entran salvo que se pida solo lo específico del país
       and (not v_hay_pais
            or exists (select 1 from db_public_requirements.requisito_jurisdiccion rj
                        where rj.requisito_id = r.id and rj.jurisdiccion = any (p_paises))
            or (not coalesce(p_solo_pais, false)
                and not exists (select 1 from db_public_requirements.requisito_jurisdiccion rj
                                 where rj.requisito_id = r.id)))
       -- alcance de las transversales (ver la cabecera)
       and (not v_hay_cats
            -- pertenece a un «qué construyes» pedido
            or exists (select 1 from db_public_requirements.requisito_categoria x
                         join db_public_requirements.categoria c on c.slug = x.categoria_slug
                        where x.requisito_id = r.id and x.categoria_slug = any (p_categorias)
                          and c.tipo in ('app_type', 'software_category'))
            -- es genérico: no pertenece a ningún tipo de app ni categoría de software
            or not exists (select 1 from db_public_requirements.requisito_categoria x
                             join db_public_requirements.categoria c on c.slug = x.categoria_slug
                            where x.requisito_id = r.id and c.tipo in ('app_type', 'software_category'))
            -- solo se han pedido transversales o flujos: la unión de siempre, pero lo
            -- regulatorio solo con país
            or (not v_construye
                and (v_hay_pais or not exists (select 1 from db_public_requirements.requisito_jurisdiccion rj
                                                where rj.requisito_id = r.id))))
       -- 0013: lo regulatorio (con jurisdicción) solo con país o pidiendo un «qué construyes»
       and (v_hay_pais or v_construye
            or not exists (select 1 from db_public_requirements.requisito_jurisdiccion rj
                            where rj.requisito_id = r.id))
     group by r.id, r.copias
    having min(rc.prioridad) <= coalesce(p_prioridad_max, 5)
  ),
  vec as (
    select x.id, row_number() over (order by x.d) as rk
      from (select f.id, r.embedding operator(extensions.<=>) v_q as d
              from filtro f
              join db_public_requirements.requisito r on r.id = f.id
             where v_q is not null and r.embedding is not null
             order by d limit 200) x
  ),
  txt as (
    select y.id, row_number() over (order by y.s desc) as rk
      from (select f.id, ts_rank_cd(r.fts, v_tsq) as s
              from filtro f
              join db_public_requirements.requisito r on r.id = f.id
             where v_tsq is not null and r.fts @@ v_tsq
             order by s desc limit 200) y
  ),
  clasif as (
    select f.id, f.prio, f.copias,
           coalesce(1.0 / (60 + vec.rk), 0) + coalesce(1.0 / (60 + txt.rk), 0) as score
      from filtro f
      left join vec on vec.id = f.id
      left join txt on txt.id = f.id
     where (v_q is null and v_tsq is null) or vec.id is not null or txt.id is not null
  ),
  ordenado as (
    select k.*, row_number() over (
             order by (case when v_orden = 'relevance' then k.score else 0 end) desc,
                      (case when v_orden = 'copies' then k.copias else 0 end) desc,
                      k.prio,
                      (case when v_orden = 'priority' then k.copias else 0 end) desc,
                      k.id) as n
      from clasif k
  )
  select jsonb_build_object(
           'total', (select count(*) from ordenado),
           'items', coalesce((select jsonb_agg(db_public_requirements.ficha(o.id, o.prio) order by o.n)
                                from ordenado o
                               where o.n > v_desde and o.n <= v_desde + v_limite), '[]'::jsonb))
    into v_res;

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
