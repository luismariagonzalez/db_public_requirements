-- Pruebas de la base de db_public_requirements. Las corre `npm run db:ensayar`
-- dentro de una transacción que se deshace al final.
--
-- Aquí nada se concede a anon ni a authenticated: la puerta es service_role
-- (api/). Se prueba que está cerrada para los demás y que la lógica funciona.

-- Vector de 768 dimensiones con un 1 en la posición k y ceros en el resto:
-- k distintas son ortogonales (distancia coseno 1), la misma k es idéntica.
create function pg_temp.v(k int) returns text language sql as $$
  select '[' || string_agg(case when g = k then '1' else '0' end, ',') || ']'
    from generate_series(1, 768) g
$$;

-- ── anon y authenticated no pueden llamar a NINGUNA función
set local role anon;
do $$ begin
  perform public.db_public_requirements_srv_categorias();
  raise exception 'anon ha podido llamar a srv_categorias';
exception when insufficient_privilege then null;
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"user_a"}';
do $$ begin
  perform public.db_public_requirements_srv_crear_key('user_a', 'x', 'rq_x', repeat('a', 64));
  raise exception 'authenticated ha podido crear una key';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from db_public_requirements.requisito;
  raise exception 'authenticated ha leído la tabla directamente';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ── desde aquí, como la API
set local role service_role;

select public.db_public_requirements_srv_upsert_categoria('messaging', 'app_type', 'Messaging app', '', 10);
select public.db_public_requirements_srv_upsert_categoria('saas-b2b', 'app_type', 'B2B SaaS', '', 20);
select public.db_public_requirements_srv_upsert_categoria('security', 'cross_cutting', 'Security', '', 10);

do $$
declare a jsonb; b jsonb; r jsonb;
begin
  a := public.db_public_requirements_srv_crear_requisito(
    'Password reset by email link',
    'Users who forgot their password can reset it through a single-use link sent by email.',
    '["The link expires","The link works only once"]', 'technical',
    '[{"slug":"messaging","priority":1},{"slug":"security","priority":2}]',
    pg_temp.v(1), 'user_a');
  b := public.db_public_requirements_srv_crear_requisito(
    'Typing indicator',
    'Participants of a conversation can see when another participant is typing.',
    '[]', 'functional', '[{"slug":"messaging","priority":4}]', pg_temp.v(2), null);

  -- slug generado
  if a->>'slug' <> 'password-reset-by-email-link' then
    raise exception 'slug inesperado: %', a->>'slug';
  end if;

  -- filtro de prioridad: con max 2 solo sale A
  r := public.db_public_requirements_srv_buscar(null, null, '{messaging}', 2, null, 50);
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> a->>'slug' then
    raise exception 'filtro prioridad<=2 falla: %', r;
  end if;
  -- sin tope salen los dos, y el de mejor prioridad primero
  r := public.db_public_requirements_srv_buscar(null, null, '{messaging}', 5, null, 50);
  if jsonb_array_length(r) <> 2 or r->0->>'slug' <> a->>'slug' then
    raise exception 'orden por prioridad falla: %', r;
  end if;
  -- filtro de categoría: security solo tiene A
  r := public.db_public_requirements_srv_buscar(null, null, '{security}', 5, null, 50);
  if jsonb_array_length(r) <> 1 then raise exception 'filtro de categoría falla'; end if;
  -- prioridad efectiva = la de las categorías pedidas, no la mejor global
  if (r->0->>'priority')::int <> 2 then
    raise exception 'la prioridad efectiva debería ser 2 en security, es %', r->0->>'priority';
  end if;
  -- clase
  r := public.db_public_requirements_srv_buscar(null, null, null, 5, '{functional}', 50);
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> b->>'slug' then
    raise exception 'filtro de clase falla';
  end if;
  -- texto completo
  r := public.db_public_requirements_srv_buscar(null, 'password reset', null, 5, null, 50);
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> a->>'slug' then
    raise exception 'búsqueda de texto falla: %', r;
  end if;
  -- vector: v(2) está más cerca de B
  r := public.db_public_requirements_srv_buscar(pg_temp.v(2), null, null, 5, null, 1);
  if r->0->>'slug' <> b->>'slug' then raise exception 'búsqueda vectorial falla: %', r; end if;

  -- similares
  r := public.db_public_requirements_srv_similares(pg_temp.v(1), 1);
  if r->0->>'slug' <> a->>'slug' or (r->0->>'similarity')::numeric < 0.99 then
    raise exception 'similares falla: %', r;
  end if;

  -- idempotencia de la semilla (mismo slug)
  r := public.db_public_requirements_srv_crear_requisito(
    'Otro título', 'Texto cualquiera suficientemente largo.', '[]', 'functional',
    '[{"slug":"messaging","priority":3}]', null, null, null, a->>'slug');
  if (r->>'created')::boolean then raise exception 'la semilla no es idempotente'; end if;

  -- fusionar: guarda versión, sube versión, añade categoría, NO cambia prioridades
  r := public.db_public_requirements_srv_fusionar(
    (a->>'id')::bigint, 'Password reset by email link',
    'Users can reset a forgotten password via a single-use, expiring email link.',
    '["The link expires","The link works only once","Old sessions are closed"]',
    '[{"slug":"saas-b2b","priority":2},{"slug":"messaging","priority":5}]',
    pg_temp.v(1), null);
  if (r->>'version')::int <> 2 then raise exception 'la versión no sube'; end if;
  reset role;
  if (select count(*) from db_public_requirements.requisito_version
       where requisito_id = (a->>'id')::bigint) <> 1 then
    raise exception 'fusionar no guarda la versión anterior';
  end if;
  if (select prioridad from db_public_requirements.requisito_categoria
       where requisito_id = (a->>'id')::bigint and categoria_slug = 'messaging') <> 1 then
    raise exception 'una fusión ha cambiado una prioridad existente';
  end if;
  if not exists (select 1 from db_public_requirements.requisito_categoria
                  where requisito_id = (a->>'id')::bigint and categoria_slug = 'saas-b2b') then
    raise exception 'una fusión no ha añadido la categoría nueva';
  end if;
  set local role service_role;

  -- categoría inexistente: falla
  begin
    perform public.db_public_requirements_srv_crear_requisito(
      'Algo sin categoría válida', 'Texto cualquiera suficientemente largo.', '[]', 'functional',
      '[{"slug":"no-existe","priority":1}]', null);
    raise exception 'ha aceptado una categoría inexistente';
  exception when foreign_key_violation then null;
  end;
  -- prioridad fuera de rango: falla
  begin
    perform public.db_public_requirements_srv_crear_requisito(
      'Algo con prioridad rara', 'Texto cualquiera suficientemente largo.', '[]', 'functional',
      '[{"slug":"messaging","priority":9}]', null);
    raise exception 'ha aceptado prioridad 9';
  exception when check_violation then null;
  end;
end $$;

-- ── cupo: el cuarto intento del minuto se corta, otra clave no se ve afectada
do $$
declare r jsonb;
begin
  for i in 1..3 loop
    if not (public.db_public_requirements_srv_cupo('ip:1', 3, 100)->>'allowed')::boolean then
      raise exception 'el cupo corta antes de tiempo';
    end if;
  end loop;
  r := public.db_public_requirements_srv_cupo('ip:1', 3, 100);
  if (r->>'allowed')::boolean or r->>'scope' <> 'minute' then
    raise exception 'el cupo por minuto no corta: %', r;
  end if;
  if not (public.db_public_requirements_srv_cupo('ip:2', 3, 100)->>'allowed')::boolean then
    raise exception 'el cupo de una clave afecta a otra';
  end if;
  r := public.db_public_requirements_srv_cupo('ip:3', 100, 1);
  r := public.db_public_requirements_srv_cupo('ip:3', 100, 1);
  if (r->>'allowed')::boolean or r->>'scope' <> 'day' then
    raise exception 'el cupo diario no corta: %', r;
  end if;
end $$;

-- ── aportes
do $$
declare id1 bigint; r jsonb;
begin
  id1 := public.db_public_requirements_srv_registrar_aporte(
    'user_a', 'The app should let users export their chat history.', '{messaging}');
  perform public.db_public_requirements_srv_resolver_aporte(id1, 'rejected', '{"reason":"duplicate"}');
  r := public.db_public_requirements_srv_mis_aportes('user_a');
  if jsonb_array_length(r) <> 1 or r->0->>'status' <> 'rejected' then
    raise exception 'mis_aportes falla: %', r;
  end if;
  if jsonb_array_length(public.db_public_requirements_srv_mis_aportes('user_b')) <> 0 then
    raise exception 'user_b ve los aportes de user_a';
  end if;
  begin
    perform public.db_public_requirements_srv_registrar_aporte(null, 'texto largo suficiente', '{}');
    raise exception 'ha aceptado un aporte sin autor';
  exception when others then
    if sqlerrm not like 'hace falta una cuenta%' then raise; end if;
  end;
  -- tope diario por persona
  begin
    for i in 1..40 loop
      perform public.db_public_requirements_srv_registrar_aporte('user_c', 'aporte número ' || i, '{}');
    end loop;
    raise exception 'el tope diario de aportes no corta';
  exception when others then
    if sqlerrm not like 'demasiados aportes%' then raise; end if;
  end;
end $$;

-- ── API keys
do $$
declare k jsonb; h text := repeat('b', 64);
begin
  k := public.db_public_requirements_srv_crear_key('user_a', 'mi agente', 'rq_ab12', h);
  if public.db_public_requirements_srv_key_por_hash(h)->>'owner' <> 'user_a' then
    raise exception 'key_por_hash no devuelve el dueño';
  end if;
  if public.db_public_requirements_srv_key_por_hash(repeat('c', 64)) is not null then
    raise exception 'key_por_hash acepta un hash desconocido';
  end if;
  -- otra persona no puede revocarla
  if public.db_public_requirements_srv_revocar_key('user_b', (k->>'id')::bigint) then
    raise exception 'user_b ha revocado la key de user_a';
  end if;
  -- la lista no incluye el hash
  if public.db_public_requirements_srv_listar_keys('user_a')::text like '%' || h || '%' then
    raise exception 'listar_keys filtra el hash';
  end if;
  if not public.db_public_requirements_srv_revocar_key('user_a', (k->>'id')::bigint) then
    raise exception 'no se puede revocar la propia key';
  end if;
  if public.db_public_requirements_srv_key_por_hash(h) is not null then
    raise exception 'una key revocada sigue valiendo';
  end if;
  -- tope de 5 activas
  begin
    for i in 1..6 loop
      perform public.db_public_requirements_srv_crear_key('user_d', 'k' || i, 'rq_' || i, md5(i::text) || md5('x' || i));
    end loop;
    raise exception 'el tope de 5 keys no corta';
  exception when others then
    if sqlerrm not like 'máximo 5 keys%' then raise; end if;
  end;
end $$;

-- ── caché de embeddings
do $$ begin
  perform public.db_public_requirements_srv_embedding_put(repeat('d', 64), pg_temp.v(3));
  if public.db_public_requirements_srv_embedding_get(repeat('d', 64)) is null then
    raise exception 'la caché de embeddings no guarda';
  end if;
  if public.db_public_requirements_srv_embedding_get(repeat('e', 64)) is not null then
    raise exception 'la caché devuelve lo que no hay';
  end if;
end $$;

-- ── borrar mis datos: borra keys y aportes y anonimiza lo publicado
do $$
declare r jsonb;
begin
  r := public.db_public_requirements_srv_borrar_mis_datos('user_a');
  if (r->>'contributions')::int <> 1 or (r->>'anonymised')::int <> 1 then
    raise exception 'borrar_mis_datos devuelve %', r;
  end if;
  reset role;
  if exists (select 1 from db_public_requirements.requisito where autor = 'user_a')
     or exists (select 1 from db_public_requirements.aporte where autor = 'user_a')
     or exists (select 1 from db_public_requirements.api_key where duenyo = 'user_a') then
    raise exception 'quedan datos de user_a';
  end if;
  set local role service_role;
  -- lo publicado sigue ahí
  if public.db_public_requirements_srv_requisito('password-reset-by-email-link') is null then
    raise exception 'borrar los datos ha borrado el requisito publicado';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  0002: tests, aceleradores, proyectos, sugerencias
-- ════════════════════════════════════════════════════════════════════════════
set local role service_role;

-- ── tests: filtros por prioridad, categoría y tipo
do $$
declare r jsonb; t1 jsonb; t2 jsonb;
begin
  t1 := public.db_public_requirements_srv_crear_test(
    'Reset link works only once', 'Request a password reset, use the link, then use it again: the second use is refused.',
    'integration', 1, '{password-reset-by-email-link}', pg_temp.v(1), 'user_t');
  t2 := public.db_public_requirements_srv_crear_test(
    'Typing indicator disappears', 'Start typing, stop for five seconds: the other participant stops seeing the indicator.',
    'e2e', 4, '{typing-indicator}', pg_temp.v(2), null);

  if t1->>'slug' <> 'reset-link-works-only-once' then raise exception 'slug de test inesperado: %', t1->>'slug'; end if;
  r := public.db_public_requirements_srv_buscar_tests(null, null, null, 2, null, 50);
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> t1->>'slug' then raise exception 'filtro de prioridad de tests falla: %', r; end if;
  r := public.db_public_requirements_srv_buscar_tests(null, null, '{messaging}', 5, null, 50);
  if jsonb_array_length(r) <> 2 or r->0->>'slug' <> t1->>'slug' then raise exception 'orden por prioridad de tests falla'; end if;
  r := public.db_public_requirements_srv_buscar_tests(null, null, '{security}', 5, null, 50);
  if jsonb_array_length(r) <> 1 then raise exception 'filtro de categoría de tests falla: %', r; end if;
  r := public.db_public_requirements_srv_buscar_tests(null, null, null, 5, '{e2e}', 50);
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> t2->>'slug' then raise exception 'filtro de tipo de test falla'; end if;
  r := public.db_public_requirements_srv_buscar_tests(null, 'password reset', null, 5, null, 50);
  if r->0->>'slug' <> t1->>'slug' then raise exception 'texto de tests falla: %', r; end if;
  r := public.db_public_requirements_srv_buscar_tests(pg_temp.v(2), null, null, 5, null, 1);
  if r->0->>'slug' <> t2->>'slug' then raise exception 'vector de tests falla'; end if;
  if public.db_public_requirements_srv_test(t1->>'slug')->'requirements' <> '["password-reset-by-email-link"]'::jsonb then
    raise exception 'ficha de test sin su requisito';
  end if;
  -- idempotente por slug y rechaza requisitos que no existen o ninguno
  if (public.db_public_requirements_srv_crear_test('x título largo', 'escenario suficientemente largo', 'unit', 1,
        '{typing-indicator}', null, null, t1->>'slug')->>'created')::boolean then
    raise exception 'crear_test no es idempotente con slug';
  end if;
  begin
    perform public.db_public_requirements_srv_crear_test('Test sin requisito real', 'Escenario suficientemente largo.', 'unit', 1, '{no-existe}', null);
    raise exception 'ha aceptado un requisito inexistente';
  exception when others then if sqlerrm not like 'el requisito % no existe' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_crear_test('Test sin requisitos', 'Escenario suficientemente largo.', 'unit', 1, '{}', null);
    raise exception 'ha aceptado un test sin requisitos';
  exception when others then if sqlerrm not like 'un test se relaciona%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_crear_test('Test prioridad rara', 'Escenario suficientemente largo.', 'unit', 7, '{typing-indicator}', null);
    raise exception 'ha aceptado prioridad 7';
  exception when check_violation then null; end;
end $$;

-- ── aceleradores: modelo, plataforma, categoría, url
do $$
declare r jsonb; a1 jsonb; a2 jsonb;
begin
  a1 := public.db_public_requirements_srv_crear_acelerador(
    'Lucia Auth', 'Open source authentication library with password reset flows built in.',
    'open_source', 'free', 'https://example.com/lucia', '{javascript,typescript}',
    '[{"slug":"password-reset-by-email-link","coverage":"full"}]', pg_temp.v(1), null);
  a2 := public.db_public_requirements_srv_crear_acelerador(
    'Realtime Cloud', 'Hosted realtime messaging service with presence and typing events.',
    'saas', 'freemium', 'https://example.com/rt', '{any}',
    '[{"slug":"typing-indicator","coverage":"partial"},{"slug":"password-reset-by-email-link","coverage":"partial"}]', pg_temp.v(2), 'user_t');

  r := public.db_public_requirements_srv_buscar_aceleradores(null, null, null, '{open_source}', null, 50);
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> a1->>'slug' then raise exception 'filtro de modelo falla: %', r; end if;
  -- «any» casa con cualquier plataforma; una librería solo con las suyas
  r := public.db_public_requirements_srv_buscar_aceleradores(null, null, null, null, '{python}', 50);
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> a2->>'slug' then raise exception 'plataforma any falla: %', r; end if;
  r := public.db_public_requirements_srv_buscar_aceleradores(null, null, null, null, '{javascript}', 50);
  if jsonb_array_length(r) <> 2 then raise exception 'plataforma javascript falla: %', r; end if;
  -- sin consulta, primero el que cubre más requisitos
  r := public.db_public_requirements_srv_buscar_aceleradores(null, null, '{messaging,security}', null, null, 50);
  if r->0->>'slug' <> a2->>'slug' then raise exception 'orden por cobertura falla: %', r; end if;
  r := public.db_public_requirements_srv_buscar_aceleradores(null, 'typing', null, null, null, 50);
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> a2->>'slug' then raise exception 'texto de aceleradores falla: %', r; end if;
  if (public.db_public_requirements_srv_acelerador(a1->>'slug')->'requirements'->0->>'coverage') <> 'full' then
    raise exception 'ficha de acelerador sin cobertura';
  end if;
  begin
    perform public.db_public_requirements_srv_crear_acelerador('Mala URL', 'Descripción suficientemente larga.',
      'saas', 'paid', 'http://inseguro.example.com', '{}', '[{"slug":"typing-indicator"}]', null);
    raise exception 'ha aceptado una URL http';
  exception when check_violation then null; end;
  begin
    perform public.db_public_requirements_srv_crear_acelerador('Mal modelo', 'Descripción suficientemente larga.',
      'gratis', 'paid', 'https://example.com', '{}', '[{"slug":"typing-indicator"}]', null);
    raise exception 'ha aceptado un modelo inválido';
  exception when check_violation then null; end;
end $$;

-- ── relacionados (para pedir requisitos con sus tests y aceleradores)
do $$
declare r jsonb;
begin
  r := public.db_public_requirements_srv_relacionados('{password-reset-by-email-link,typing-indicator}', true, 5, true);
  if jsonb_array_length(r->'password-reset-by-email-link'->'tests') <> 1
     or jsonb_array_length(r->'password-reset-by-email-link'->'accelerators') <> 2 then
    raise exception 'relacionados falla: %', r;
  end if;
  r := public.db_public_requirements_srv_relacionados('{typing-indicator}', true, 2, false);
  if jsonb_array_length(r->'typing-indicator'->'tests') <> 0 or jsonb_array_length(r->'typing-indicator'->'accelerators') <> 0 then
    raise exception 'relacionados no respeta tests_max ni aceleradores=false: %', r;
  end if;
  begin
    perform public.db_public_requirements_srv_relacionados(array(select 'x' || g from generate_series(1, 201) g), true, 5, true);
    raise exception 'ha aceptado más de 200 requisitos';
  exception when others then if sqlerrm not like 'demasiados requisitos%' then raise; end if; end;
end $$;

-- ── proyectos: dueño, estados, desconocidos, tope
do $$
declare p jsonb; id1 bigint; r jsonb;
begin
  p := public.db_public_requirements_srv_crear_proyecto('user_p', 'Mi app de chat', 'prueba', '{messaging}');
  id1 := (p->>'id')::bigint;
  begin
    perform public.db_public_requirements_srv_crear_proyecto('user_p', 'mi APP de chat', '', '{}');
    raise exception 'ha aceptado un nombre duplicado (sin distinguir mayúsculas)';
  exception when others then if sqlerrm not like 'ya tienes un proyecto%' then raise; end if; end;
  -- otro usuario puede usar el mismo nombre
  perform public.db_public_requirements_srv_crear_proyecto('user_q', 'Mi app de chat', '', '{}');

  r := public.db_public_requirements_srv_marcar_items('user_p', id1, jsonb_build_array(
    jsonb_build_object('type', 'requirement', 'slug', 'password-reset-by-email-link', 'status', 'done'),
    jsonb_build_object('type', 'requirement', 'slug', 'typing-indicator', 'status', 'planned', 'note', 'next sprint'),
    jsonb_build_object('type', 'test', 'slug', 'reset-link-works-only-once', 'status', 'in_progress'),
    jsonb_build_object('type', 'accelerator', 'slug', 'lucia-auth', 'status', 'done'),
    jsonb_build_object('type', 'requirement', 'slug', 'no-existe-nada', 'status', 'done')));
  if (r->>'updated')::int <> 4 or r->'unknown' <> '["requirement:no-existe-nada"]'::jsonb then
    raise exception 'marcar_items falla: %', r;
  end if;
  -- actualizar un estado conserva la nota si no se manda
  perform public.db_public_requirements_srv_marcar_items('user_p', id1,
    '[{"type":"requirement","slug":"typing-indicator","status":"done"}]');
  r := public.db_public_requirements_srv_estados_proyecto('user_p', id1);
  if r->>'requirement:typing-indicator' <> 'done' or r->>'test:reset-link-works-only-once' <> 'in_progress' then
    raise exception 'estados_proyecto falla: %', r;
  end if;
  r := public.db_public_requirements_srv_proyecto('user_p', id1);
  if jsonb_array_length(r->'items') <> 4 then raise exception 'proyecto sin sus items: %', r; end if;
  if not (r->'items')::text like '%next sprint%' then raise exception 'se ha perdido la nota al actualizar el estado'; end if;
  r := public.db_public_requirements_srv_listar_proyectos('user_p');
  if (r->0->'counts'->>'done')::int <> 3 or (r->0->'counts'->>'in_progress')::int <> 1 then
    raise exception 'conteos de proyecto falla: %', r;
  end if;

  -- user_q no ve ni toca el proyecto de user_p
  if public.db_public_requirements_srv_proyecto('user_q', id1) is not null then raise exception 'user_q ve el proyecto de user_p'; end if;
  if public.db_public_requirements_srv_estados_proyecto('user_q', id1) is not null then raise exception 'user_q ve los estados de user_p'; end if;
  begin
    perform public.db_public_requirements_srv_marcar_items('user_q', id1, '[{"type":"requirement","slug":"typing-indicator","status":"done"}]');
    raise exception 'user_q ha marcado items en el proyecto de user_p';
  exception when others then if sqlerrm not like 'proyecto no encontrado%' then raise; end if; end;
  if public.db_public_requirements_srv_borrar_proyecto('user_q', id1) then raise exception 'user_q ha borrado el proyecto de user_p'; end if;

  -- validaciones
  begin
    perform public.db_public_requirements_srv_marcar_items('user_p', id1, '[{"type":"requirement","slug":"typing-indicator","status":"hecho"}]');
    raise exception 'ha aceptado un estado inválido';
  exception when others then if sqlerrm not like 'estado inválido%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_marcar_items('user_p', id1, '[{"type":"magia","slug":"typing-indicator","status":"done"}]');
    raise exception 'ha aceptado un tipo inválido';
  exception when others then if sqlerrm not like 'tipo inválido%' then raise; end if; end;

  -- tope de 20 proyectos por persona
  begin
    for i in 1..25 loop perform public.db_public_requirements_srv_crear_proyecto('user_p', 'proyecto ' || i, '', '{}'); end loop;
    raise exception 'el tope de proyectos no corta';
  exception when others then if sqlerrm not like 'máximo 20 proyectos%' then raise; end if; end;
end $$;

-- ── sugerencias
do $$
declare id1 bigint; r jsonb;
begin
  id1 := public.db_public_requirements_srv_sugerir('user_s', 'improvement', 'requirement', 'typing-indicator',
    'It should also cover group conversations with more than two people.');
  perform public.db_public_requirements_srv_sugerir('user_s', 'new_item', 'general', null, 'A requirement about message retention policies.');
  r := public.db_public_requirements_srv_mis_sugerencias('user_s');
  if jsonb_array_length(r) <> 2 then raise exception 'mis_sugerencias falla: %', r; end if;
  if jsonb_array_length(public.db_public_requirements_srv_mis_sugerencias('user_z')) <> 0 then
    raise exception 'user_z ve las sugerencias de user_s';
  end if;
  begin
    perform public.db_public_requirements_srv_sugerir('user_s', 'report', 'test', 'no-existe-el-test', 'This test does not seem right at all.');
    raise exception 'ha aceptado un objetivo inexistente';
  exception when others then if sqlerrm not like 'el objetivo no existe%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_sugerir(null, 'report', 'general', null, 'Sin autor no debería entrar.');
    raise exception 'ha aceptado una sugerencia sin autor';
  exception when others then if sqlerrm not like 'hace falta una cuenta%' then raise; end if; end;
  begin
    for i in 1..25 loop
      perform public.db_public_requirements_srv_sugerir('user_s', 'report', 'general', null, 'Sugerencia número ' || i || ' de relleno.');
    end loop;
    raise exception 'el tope diario de sugerencias no corta';
  exception when others then if sqlerrm not like 'demasiadas sugerencias%' then raise; end if; end;
end $$;

-- ── borrar mis datos ahora también borra proyectos y sugerencias
do $$
declare r jsonb;
begin
  -- (los proyectos de la prueba del tope se deshicieron con su subtransacción: queda 1)
  r := public.db_public_requirements_srv_borrar_mis_datos('user_p');
  if (r->>'projects')::int <> 1 then raise exception 'borrar_mis_datos no borra los proyectos: %', r; end if;
  if jsonb_array_length(public.db_public_requirements_srv_listar_proyectos('user_p')) <> 0 then
    raise exception 'quedan proyectos de user_p';
  end if;
  r := public.db_public_requirements_srv_borrar_mis_datos('user_s');
  if (r->>'suggestions')::int <> 2 then raise exception 'borrar_mis_datos no borra las sugerencias: %', r; end if;
  -- lo publicado por user_t (test) sigue ahí, sin autor
  r := public.db_public_requirements_srv_borrar_mis_datos('user_t');
  if public.db_public_requirements_srv_test('reset-link-works-only-once') is null then
    raise exception 'borrar los datos ha borrado un test publicado';
  end if;
  -- otro usuario conserva lo suyo
  if jsonb_array_length(public.db_public_requirements_srv_listar_proyectos('user_q')) <> 1 then
    raise exception 'borrar_mis_datos ha tocado los proyectos de otro usuario';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  0003: jerarquía audiencia → dominio → categoría de software
-- ════════════════════════════════════════════════════════════════════════════
set local role service_role;

do $$
declare r jsonb; c jsonb;
begin
  perform public.db_public_requirements_srv_upsert_categoria('b2b', 'audience', 'B2B', 'Sold to businesses', 10);
  perform public.db_public_requirements_srv_upsert_categoria('b2c', 'audience', 'B2C', 'Sold to consumers', 20);
  perform public.db_public_requirements_srv_upsert_categoria('finance', 'domain', 'Finance & Accounting', '', 10);
  perform public.db_public_requirements_srv_upsert_categoria('accounting-software', 'software_category', 'Accounting', '', 10,
    'finance', '{b2b,b2c}');
  -- la llamada de 5 argumentos sigue valiendo (sin ambigüedad) y no toca la jerarquía de otras
  perform public.db_public_requirements_srv_upsert_categoria('tax-prep', 'software_category', 'Tax preparation', '', 20);

  r := public.db_public_requirements_srv_categorias();
  select x into c from jsonb_array_elements(r) x where x->>'slug' = 'accounting-software';
  if c->>'type' <> 'software_category' or c->>'domain' <> 'finance' or c->'audiences' <> '["b2b","b2c"]'::jsonb then
    raise exception 'categorias no devuelve la jerarquía: %', c;
  end if;
  select x into c from jsonb_array_elements(r) x where x->>'slug' = 'tax-prep';
  if c->>'domain' is not null or c->'audiences' <> '[]'::jsonb then raise exception 'tax-prep debería ir sin jerarquía: %', c; end if;

  -- actualizar conserva el contrato: cambia dominio y audiencias
  perform public.db_public_requirements_srv_upsert_categoria('accounting-software', 'software_category', 'Accounting', '', 10, 'finance', '{b2b}');
  select x into c from jsonb_array_elements(public.db_public_requirements_srv_categorias()) x where x->>'slug' = 'accounting-software';
  if c->'audiences' <> '["b2b"]'::jsonb then raise exception 'no actualiza las audiencias: %', c; end if;

  begin
    perform public.db_public_requirements_srv_upsert_categoria('x-one', 'software_category', 'X One', '', 1, 'no-existe', '{}');
    raise exception 'ha aceptado un dominio inexistente';
  exception when others then if sqlerrm not like 'el dominio % no existe' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_upsert_categoria('x-two', 'software_category', 'X Two', '', 1, 'b2b', '{}');
    raise exception 'ha aceptado una audiencia como dominio';
  exception when others then if sqlerrm not like 'el dominio % no existe' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_upsert_categoria('x-three', 'software_category', 'X Three', '', 1, 'finance', '{b2x}');
    raise exception 'ha aceptado una audiencia inexistente';
  exception when others then if sqlerrm not like 'la audiencia % no existe' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_upsert_categoria('x-four', 'tipo_raro', 'X Four', '', 1);
    raise exception 'ha aceptado un tipo de categoría inválido';
  exception when check_violation then null; end;
end $$;

reset role;

-- ════════════════════════════════════════════════════════════════════════════
--  0004: arquetipos con herencia, flujos con familia, copias y orden
-- ════════════════════════════════════════════════════════════════════════════
set local role service_role;

do $$
declare r jsonb; c jsonb; a jsonb; d jsonb; e jsonb; n int;
begin
  -- el dominio de mentira ya no existe y los flujos/arquetipos nuevos sí
  r := public.db_public_requirements_srv_categorias();
  if exists (select 1 from jsonb_array_elements(r) x where x->>'slug' = 'app-archetypes') then
    raise exception 'app-archetypes debería haber desaparecido';
  end if;
  select x into c from jsonb_array_elements(r) x where x->>'slug' = 'flow-sign-in';
  if c->>'type' <> 'screen_type' or c->>'family' <> 'account' then raise exception 'flow-sign-in mal: %', c; end if;
  select x into c from jsonb_array_elements(r) x where x->>'slug' = 'other-business-software';
  if c->>'type' <> 'app_type' or c->>'domain' is not null then raise exception 'other-business-software mal: %', c; end if;

  -- una categoría de software hereda de arquetipos que existen (y solo de tipos de app)
  perform public.db_public_requirements_srv_upsert_categoria('crm-tools', 'software_category', 'CRM', '', 5,
    'finance', '{b2b}', null, '{crm-sales,helpdesk-support}');
  select x into c from jsonb_array_elements(public.db_public_requirements_srv_categorias()) x where x->>'slug' = 'crm-tools';
  if c->'archetypes' <> '["crm-sales","helpdesk-support"]'::jsonb then raise exception 'archetypes mal: %', c; end if;
  begin
    perform public.db_public_requirements_srv_upsert_categoria('crm-bad', 'software_category', 'Bad', '', 5,
      'finance', '{b2b}', null, '{b2b}');
    raise exception 'ha aceptado una audiencia como arquetipo';
  exception when others then if sqlerrm not like 'el arquetipo % no existe' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_upsert_categoria('crm-bad', 'software_category', 'Bad', '', 5,
      'finance', '{b2b}', null, '{crm-sales,helpdesk-support,erp-operations,hr-people}');
    raise exception 'ha aceptado más de 3 arquetipos';
  exception when check_violation then null; end;

  -- copias y orden: E (P1, 0 copias), D (P2, 3 copias), C (P2, 1 copia), todos en saas-b2b
  perform public.db_public_requirements_srv_upsert_categoria('saas-b2b', 'app_type', 'B2B SaaS', '', 20);
  e := public.db_public_requirements_srv_crear_requisito('Order test essential item',
    'The product must keep an essential behaviour for the ordering test.', '[]', 'functional',
    '[{"slug":"saas-b2b","priority":1}]', pg_temp.v(11), null);
  d := public.db_public_requirements_srv_crear_requisito('Order test popular item',
    'The product must keep a popular behaviour for the ordering test.', '[]', 'functional',
    '[{"slug":"saas-b2b","priority":2}]', pg_temp.v(12), null);
  c := public.db_public_requirements_srv_crear_requisito('Order test quiet item',
    'The product must keep a quiet behaviour for the ordering test.', '[]', 'functional',
    '[{"slug":"saas-b2b","priority":2}]', pg_temp.v(13), null);

  if public.db_public_requirements_srv_contar_copias(array[c->>'slug'], 'p1') <> 1 then raise exception 'primera copia no cuenta'; end if;
  if public.db_public_requirements_srv_contar_copias(array[c->>'slug'], 'p1') <> 0 then raise exception 'la misma persona el mismo día no debería sumar'; end if;
  perform public.db_public_requirements_srv_contar_copias(array[d->>'slug'], 'p1');
  perform public.db_public_requirements_srv_contar_copias(array[d->>'slug'], 'p2');
  n := public.db_public_requirements_srv_contar_copias(array[d->>'slug', 'no-existe'], 'p3');
  if n <> 1 then raise exception 'un slug inexistente no debe contar: %', n; end if;
  if public.db_public_requirements_srv_contar_copias('{}', 'p1') <> 0 then raise exception 'lista vacía debería dar 0'; end if;

  -- orden por defecto (priority): P1 primero y, entre P2, el más copiado
  r := public.db_public_requirements_srv_buscar(null, null, '{saas-b2b}', 5, null, 50);
  if r->0->>'slug' <> e->>'slug' or r->1->>'slug' <> d->>'slug' or r->2->>'slug' <> c->>'slug' then
    raise exception 'orden priority falla: %', (select jsonb_agg(x->>'slug') from jsonb_array_elements(r) x);
  end if;
  if (r->1->>'copies')::int <> 3 or (r->2->>'copies')::int <> 1 then raise exception 'copies mal en la ficha: %', r; end if;
  -- orden por copiados: D, C, E
  r := public.db_public_requirements_srv_buscar(null, null, '{saas-b2b}', 5, null, 50, 'copies');
  if r->0->>'slug' <> d->>'slug' or r->1->>'slug' <> c->>'slug' or r->2->>'slug' <> e->>'slug' then
    raise exception 'orden copies falla: %', (select jsonb_agg(x->>'slug') from jsonb_array_elements(r) x);
  end if;
  -- con límite, el orden se aplica antes de cortar
  r := public.db_public_requirements_srv_buscar(null, null, '{saas-b2b}', 5, null, 1, 'copies');
  if r->0->>'slug' <> d->>'slug' or jsonb_array_length(r) <> 1 then raise exception 'copies + limite falla: %', r; end if;
  begin
    perform public.db_public_requirements_srv_buscar(null, null, null, 5, null, 5, 'raro');
    raise exception 'ha aceptado un orden desconocido';
  exception when others then if sqlerrm not like 'orden desconocido%' then raise; end if; end;
end $$;

-- lo que se guarda para contar copias se purga a los 2 días
reset role;
insert into db_public_requirements.copia (requisito_id, quien, dia)
  select id, 'viejo', current_date - 5 from db_public_requirements.requisito limit 1;
select set_config('ensayo.slug', (select slug from db_public_requirements.requisito limit 1), true);
set local role service_role;
select public.db_public_requirements_srv_contar_copias(array[current_setting('ensayo.slug')], 'otro');
reset role;
do $$ begin
  if exists (select 1 from db_public_requirements.copia where dia < current_date - 2) then
    raise exception 'las copias de hace más de 2 días deberían purgarse';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  0005: clase funcional/técnico, acceso en tres flujos y fechas que se mantienen solas
-- ════════════════════════════════════════════════════════════════════════════
set local role service_role;

do $$
declare a jsonb; b jsonb; r jsonb; v1 timestamptz; v2 timestamptz; n jsonb;
begin
  -- la clase ya solo admite dos valores
  begin
    perform public.db_public_requirements_srv_crear_requisito('Rejected class item',
      'The product must reject any class that is not functional or technical.', '[]', 'security',
      '[{"slug":"saas-b2b","priority":3}]', pg_temp.v(21), null);
    raise exception 'ha aceptado la clase security';
  exception when check_violation then null; end;

  -- srv_reorganizar: clases, transversales, herencia y acceso
  perform public.db_public_requirements_srv_upsert_categoria('flow-sign-up', 'screen_type', 'Sign-up', '', 11);
  a := public.db_public_requirements_srv_crear_requisito('Reorg access item',
    'The product must let people recover access to a locked account.', '[]', 'functional',
    '[{"slug":"flow-sign-up","priority":2},{"slug":"flow-sign-in","priority":2},{"slug":"flow-recovery","priority":2}]',
    pg_temp.v(22), null);
  select (x->>'updated_at')::timestamptz into v1 from (select public.db_public_requirements_srv_requisito(a->>'slug') x) q;

  n := public.db_public_requirements_srv_reorganizar(jsonb_build_object(
    'clases', jsonb_build_object(a->>'slug', 'technical', 'no-existe', 'functional', 'otro', 'raro'),
    'acceso', jsonb_build_object(a->>'slug', '["flow-recovery"]'::jsonb),
    'transversales', jsonb_build_array(jsonb_build_object('slug', a->>'slug', 'categoria', 'security', 'prioridad', 1),
                                       jsonb_build_object('slug', a->>'slug', 'categoria', 'saas-b2b', 'prioridad', 1)),
    'herencia', jsonb_build_object('crm-tools', '["crm-sales","b2b","helpdesk-support","erp-operations"]'::jsonb)));
  if n <> '{"clases":1,"acceso":1,"transversales":1,"herencia":1}'::jsonb then raise exception 'srv_reorganizar devuelve %', n; end if;

  r := public.db_public_requirements_srv_requisito(a->>'slug');
  if r->>'kind' <> 'technical' then raise exception 'la clase no cambió: %', r->>'kind'; end if;
  if (select array_agg(x->>'slug' order by x->>'slug') from jsonb_array_elements(r->'categories') x)
       <> array['flow-recovery', 'security'] then
    raise exception 'categorías tras reorganizar: %', r->'categories';
  end if;
  if (r->'categories'->0->>'priority')::int <> 1 and (r->'categories'->1->>'priority')::int <> 1 then
    raise exception 'la prioridad del transversal nuevo se perdió: %', r->'categories';
  end if;
  -- solo cuenta arquetipos que existen y son tipos de app, y como mucho 3
  select x into b from jsonb_array_elements(public.db_public_requirements_srv_categorias()) x where x->>'slug' = 'crm-tools';
  if b->'archetypes' <> '["crm-sales","erp-operations","helpdesk-support"]'::jsonb then raise exception 'herencia mal: %', b->'archetypes'; end if;
  -- reorganizar no cuenta como editar: la fecha no se movió
  if (r->>'updated_at')::timestamptz <> v1 then raise exception 'srv_reorganizar no debería tocar actualizado_en'; end if;
end $$;

-- las fechas se mantienen solas: editar el contenido o una prioridad la mueve; sumar copias no
reset role;
-- (en producción cada llamada es su propia transacción; aquí todo es una, así que se apaga el interruptor de srv_reorganizar)
select set_config('reqdb.sin_fechas', '', true);
do $$
declare id1 bigint; v0 timestamptz; v1 timestamptz;
begin
  select id into id1 from db_public_requirements.requisito where slug = 'order-test-popular-item';
  update db_public_requirements.requisito set actualizado_en = now() - interval '10 days' where id = id1;
  select actualizado_en into v0 from db_public_requirements.requisito where id = id1;

  update db_public_requirements.requisito set copias = copias + 5 where id = id1;
  select actualizado_en into v1 from db_public_requirements.requisito where id = id1;
  if v1 <> v0 then raise exception 'sumar copias no debería mover actualizado_en'; end if;

  update db_public_requirements.requisito set enunciado = enunciado || ' (reworded)' where id = id1;
  select actualizado_en into v1 from db_public_requirements.requisito where id = id1;
  if v1 <= v0 then raise exception 'cambiar el enunciado debería mover actualizado_en'; end if;

  update db_public_requirements.requisito set actualizado_en = v0 where id = id1;
  update db_public_requirements.requisito_categoria set prioridad = 4 where requisito_id = id1;
  select actualizado_en into v1 from db_public_requirements.requisito where id = id1;
  if v1 <= v0 then raise exception 'cambiar una prioridad debería mover actualizado_en del requisito'; end if;
end $$;
