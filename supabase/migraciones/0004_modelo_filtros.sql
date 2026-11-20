-- ════════════════════════════════════════════════════════════════════════════
--  0004 · modelo de filtros: flujos con familia, arquetipos con herencia,
--         contador de copias y orden de resultados
--
--  · Los tipos de app dejan de colgar del dominio inventado «app-archetypes».
--  · Se añaden arquetipos de app (CRM, helpdesk, ERP…) y los flujos de acceso
--    (registro, inicio de sesión, recuperación). `screen-auth` sigue existiendo
--    hasta la 0005, que reparte sus requisitos y lo retira.
--  · Una categoría de software hereda de 1-3 tipos de app (`arquetipos`).
--  · Cada requisito lleva un contador global de copias (una por persona y día).
--  · La búsqueda acepta un orden: priority | copies | relevance.
--
--  La restricción de `clase` NO cambia aquí: va en la 0005, con los datos.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────── categorías
alter table db_public_requirements.categoria
  add column familia text check (familia is null or familia ~ '^[a-z][a-z-]{1,29}$'),
  add column arquetipos text[] not null default '{}' check (cardinality(arquetipos) <= 3);
create index on db_public_requirements.categoria using gin (arquetipos);

-- Los tipos de app ya no cuelgan de un dominio de mentira.
update db_public_requirements.categoria set dominio = null where dominio = 'app-archetypes';
delete from db_public_requirements.categoria where slug = 'app-archetypes' and tipo = 'domain';

-- Familias de los flujos (tipo screen_type, que se muestra como «Flow»).
update db_public_requirements.categoria set familia = v.familia
  from (values
    ('screen-auth', 'account'), ('screen-onboarding', 'account'), ('screen-profile', 'account'), ('screen-settings', 'account'),
    ('screen-search', 'discover'), ('screen-feed', 'discover'), ('screen-chat', 'discover'),
    ('screen-checkout', 'buy'),
    ('screen-dashboard', 'manage'), ('screen-admin', 'manage'), ('screen-forms', 'manage'),
    ('screen-landing', 'attract')) as v (slug, familia)
 where categoria.slug = v.slug and categoria.tipo = 'screen_type';

-- Flujos nuevos: el acceso se parte en tres.
insert into db_public_requirements.categoria (slug, tipo, nombre, descripcion, orden, familia) values
  ('flow-sign-up',   'screen_type', 'Sign-up',           'Creating an account: required data, verification, terms, duplicate accounts, abuse protection.', 11, 'account'),
  ('flow-sign-in',   'screen_type', 'Sign-in',           'Logging in: credentials, social login, sessions, throttling, multi-factor, sign-out.', 12, 'account'),
  ('flow-recovery',  'screen_type', 'Account recovery',  'Getting back in: password reset, recovery codes, locked or compromised accounts.', 13, 'account')
on conflict (slug) do nothing;

-- Arquetipos nuevos: dónde aterrizan las categorías de software que no son
-- ninguno de los 16 originales. `other-business-software` es el cajón de sastre.
insert into db_public_requirements.categoria (slug, tipo, nombre, descripcion, orden, audiencias) values
  ('crm-sales',               'app_type', 'CRM / sales',                    'Contacts, accounts, deals, pipelines, activities and sales forecasting.', 17, '{b2b}'),
  ('marketing-automation',    'app_type', 'Marketing automation',           'Campaigns, audiences, email/SMS sending, landing pages, lead scoring and attribution.', 18, '{b2b}'),
  ('helpdesk-support',        'app_type', 'Helpdesk / customer support',    'Tickets, queues, SLAs, knowledge base, live chat and customer satisfaction.', 19, '{b2b}'),
  ('erp-operations',          'app_type', 'ERP / operations',               'Orders, inventory, purchasing, production, shipping and work orders.', 20, '{b2b}'),
  ('accounting-invoicing',    'app_type', 'Accounting / invoicing',         'Invoices, payments, ledgers, taxes, expenses and financial reporting.', 21, '{b2b,b2c}'),
  ('hr-people',               'app_type', 'HR / people management',         'Employee records, recruiting, onboarding, leave, payroll and performance.', 22, '{b2b,internal}'),
  ('healthcare-clinical',     'app_type', 'Healthcare / clinical',          'Patients, appointments, clinical records, prescriptions, billing and consent.', 23, '{b2b,b2c}'),
  ('property-real-estate',    'app_type', 'Property / real estate',         'Listings, tenants, leases, maintenance, viewings and property accounting.', 24, '{b2b,b2c}'),
  ('field-service-fleet',     'app_type', 'Field service / fleet',          'Jobs, dispatch, routes, vehicles, assets, mobile work and proof of service.', 25, '{b2b}'),
  ('developer-platform-api',  'app_type', 'Developer platform / API',       'API keys, SDKs, webhooks, rate limits, documentation, sandboxes and usage billing.', 26, '{developer,b2b}'),
  ('video-voice-communication','app_type','Video / voice communication',    'Calls, meetings, recording, presence, device handling and call quality.', 27, '{b2c,b2b}'),
  ('internal-tool-backoffice','app_type', 'Internal tool / back-office',    'Admin screens over company data: roles, audit trails, approvals and bulk edits.', 28, '{internal}'),
  ('other-business-software', 'app_type', 'Other business software',       'Generic business application: accounts, roles, data records, notifications and reports.', 29, '{b2b,internal}')
on conflict (slug) do nothing;

-- upsert_categoria gana familia y arquetipos (se retira la firma anterior).
drop function public.db_public_requirements_srv_upsert_categoria(text, text, text, text, int, text, text[]);

create function public.db_public_requirements_srv_upsert_categoria(
  p_slug text, p_tipo text, p_nombre text, p_descripcion text, p_orden int,
  p_dominio text default null, p_audiencias text[] default null,
  p_familia text default null, p_arquetipos text[] default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare a text;
begin
  if p_dominio is not null and not exists (
       select 1 from db_public_requirements.categoria where slug = p_dominio and tipo = 'domain') then
    raise exception 'el dominio % no existe', p_dominio;
  end if;
  foreach a in array coalesce(p_audiencias, '{}') loop
    if not exists (select 1 from db_public_requirements.categoria where slug = a and tipo = 'audience') then
      raise exception 'la audiencia % no existe', a;
    end if;
  end loop;
  foreach a in array coalesce(p_arquetipos, '{}') loop
    if not exists (select 1 from db_public_requirements.categoria where slug = a and tipo = 'app_type') then
      raise exception 'el arquetipo % no existe', a;
    end if;
  end loop;

  insert into db_public_requirements.categoria
    (slug, tipo, nombre, descripcion, orden, dominio, audiencias, familia, arquetipos)
  values (p_slug, p_tipo, p_nombre, coalesce(p_descripcion, ''), coalesce(p_orden, 100),
          p_dominio, coalesce(p_audiencias, '{}'), p_familia, coalesce(p_arquetipos, '{}'))
  on conflict (slug) do update
    set tipo = excluded.tipo, nombre = excluded.nombre, descripcion = excluded.descripcion,
        orden = excluded.orden, dominio = excluded.dominio, audiencias = excluded.audiencias,
        familia = excluded.familia, arquetipos = excluded.arquetipos;
end;
$$;

create or replace function public.db_public_requirements_srv_categorias()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', c.slug, 'type', c.tipo, 'name', c.nombre, 'description', c.descripcion,
           'domain', c.dominio, 'audiences', to_jsonb(c.audiencias),
           'family', c.familia, 'archetypes', to_jsonb(c.arquetipos),
           'requirements', (select count(*) from db_public_requirements.requisito_categoria rc
                              join db_public_requirements.requisito r on r.id = rc.requisito_id
                             where rc.categoria_slug = c.slug and r.estado = 'published'))
         order by c.tipo, c.orden, c.nombre), '[]'::jsonb)
  from db_public_requirements.categoria c
$$;

-- ─────────────────────────────────────────────────── contador de copias
-- Una persona (hash con sal de su IP, o el dueño de su clave) suma una copia por
-- requisito y día. Lo que se guarda para ello se purga a los 2 días, igual que el cupo.
alter table db_public_requirements.requisito add column copias int not null default 0;

create table db_public_requirements.copia (
  requisito_id bigint not null references db_public_requirements.requisito (id) on delete cascade,
  quien        text not null,
  dia          date not null default current_date,
  primary key (requisito_id, quien, dia)
);
create index on db_public_requirements.copia (dia);
alter table db_public_requirements.copia enable row level security;

create function public.db_public_requirements_srv_contar_copias(p_slugs text[], p_quien text)
returns int language plpgsql volatile security definer set search_path = '' as $$
declare v_n int;
begin
  if coalesce(cardinality(p_slugs), 0) = 0 or cardinality(p_slugs) > 200 or coalesce(p_quien, '') = '' then
    return 0;
  end if;
  delete from db_public_requirements.copia where dia < current_date - 2;
  with nuevas as (
    insert into db_public_requirements.copia (requisito_id, quien)
    select r.id, p_quien
      from db_public_requirements.requisito r
     where r.slug = any (p_slugs) and r.estado = 'published'
    on conflict do nothing
    returning requisito_id),
  suma as (
    update db_public_requirements.requisito r set copias = r.copias + 1
      from nuevas where r.id = nuevas.requisito_id
    returning 1)
  select count(*) into v_n from suma;
  return v_n;
end;
$$;

-- ─────────────────────────────────────────────────── fichas y búsqueda
create or replace function db_public_requirements.ficha(p_id bigint, p_prio int default null)
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
    'copies', r.copias,
    'version', r.version,
    'updated_at', r.actualizado_en)
  from db_public_requirements.requisito r
  where r.id = p_id
$$;

-- Orden: priority (mejor prioridad, luego más copiados), copies (más copiados,
-- luego prioridad) o relevance (RRF de significado y texto). Sin consulta, por
-- defecto priority; con consulta, relevance.
drop function public.db_public_requirements_srv_buscar(text, text, text[], int, text[], int);

create function public.db_public_requirements_srv_buscar(
  p_vec text, p_texto text, p_categorias text[], p_prioridad_max int,
  p_clases text[], p_limite int, p_orden text default null)
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
