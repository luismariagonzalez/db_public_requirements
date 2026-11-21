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
  r := public.db_public_requirements_srv_buscar(null, null, '{messaging}', 2, null, 50)->'items';
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> a->>'slug' then
    raise exception 'filtro prioridad<=2 falla: %', r;
  end if;
  -- sin tope salen los dos, y el de mejor prioridad primero
  r := public.db_public_requirements_srv_buscar(null, null, '{messaging}', 5, null, 50)->'items';
  if jsonb_array_length(r) <> 2 or r->0->>'slug' <> a->>'slug' then
    raise exception 'orden por prioridad falla: %', r;
  end if;
  -- filtro de categoría: security solo tiene A
  r := public.db_public_requirements_srv_buscar(null, null, '{security}', 5, null, 50)->'items';
  if jsonb_array_length(r) <> 1 then raise exception 'filtro de categoría falla'; end if;
  -- prioridad efectiva = la de las categorías pedidas, no la mejor global
  if (r->0->>'priority')::int <> 2 then
    raise exception 'la prioridad efectiva debería ser 2 en security, es %', r->0->>'priority';
  end if;
  -- clase
  r := public.db_public_requirements_srv_buscar(null, null, null, 5, '{functional}', 50)->'items';
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> b->>'slug' then
    raise exception 'filtro de clase falla';
  end if;
  -- texto completo
  r := public.db_public_requirements_srv_buscar(null, 'password reset', null, 5, null, 50)->'items';
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> a->>'slug' then
    raise exception 'búsqueda de texto falla: %', r;
  end if;
  -- vector: v(2) está más cerca de B
  r := public.db_public_requirements_srv_buscar(pg_temp.v(2), null, null, 5, null, 1)->'items';
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
  -- fila antigua (0002): sigue siendo válida y se sigue leyendo
  reset role;
  insert into db_public_requirements.sugerencia (autor, tipo, objetivo_tipo, objetivo_slug, texto)
  values ('user_s', 'improvement', 'requirement', 'typing-indicator', 'It should also cover group conversations with more than two people.');
  set local role service_role;
  -- sugerencia nueva (0010): sobre la app
  id1 := public.db_public_requirements_srv_sugerir('user_s', 'feature', 'app', null, 'Let me export my whole project as a single file.');
  r := public.db_public_requirements_srv_mis_sugerencias('user_s');
  if jsonb_array_length(r) <> 2 then raise exception 'mis_sugerencias falla: %', r; end if;
  if (select count(*) from jsonb_array_elements(r) e where e->>'kind' = 'feature' and e->>'target_type' = 'app') <> 1 then
    raise exception 'la sugerencia nueva no queda como feature/app: %', r;
  end if;
  if (select count(*) from jsonb_array_elements(r) e where e->>'kind' = 'improvement' and e->>'target' = 'typing-indicator') <> 1 then
    raise exception 'la fila antigua ya no se lee: %', r;
  end if;
  begin
    perform public.db_public_requirements_srv_sugerir('user_s', 'improvement', 'requirement', 'typing-indicator', 'Old style suggestions are not accepted any more.');
    raise exception 'ha aceptado un tipo antiguo';
  exception when others then if sqlerrm not like 'tipo de sugerencia no válido%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_sugerir('user_s', 'problem', 'test', 'reset-link-works-only-once', 'A suggestion about a test must go through contribute.');
    raise exception 'ha aceptado un objetivo que no es la app';
  exception when others then if sqlerrm not like 'las sugerencias son sobre la app%' then raise; end if; end;
  if jsonb_array_length(public.db_public_requirements_srv_mis_sugerencias('user_z')) <> 0 then
    raise exception 'user_z ve las sugerencias de user_s';
  end if;
  begin
    perform public.db_public_requirements_srv_sugerir(null, 'problem', 'app', null, 'Sin autor no debería entrar.');
    raise exception 'ha aceptado una sugerencia sin autor';
  exception when others then if sqlerrm not like 'hace falta una cuenta%' then raise; end if; end;
  begin
    for i in 1..25 loop
      perform public.db_public_requirements_srv_sugerir('user_s', 'problem', 'app', null, 'Sugerencia número ' || i || ' de relleno.');
    end loop;
    raise exception 'el tope diario de sugerencias no corta';
  exception when others then if sqlerrm not like 'demasiadas sugerencias%' then raise; end if; end;
end $$;

-- ── herramientas (0010)
do $$
declare r jsonb;
begin
  perform public.db_public_requirements_srv_upsert_herramienta('ensayo-b', 'Beta tool', 'library', 'Second by order.',
    'https://github.com/example/beta', null, array['web'], 'active', 20);
  perform public.db_public_requirements_srv_upsert_herramienta('ensayo-a', 'Alpha tool', 'auth', 'First by order.',
    null, 'https://example.com/docs', array['web', 'node'], 'active', 10);
  perform public.db_public_requirements_srv_upsert_herramienta('ensayo-oculta', 'Hidden tool', 'other', '',
    'https://github.com/example/hidden', null, '{}', 'hidden', 5);
  r := public.db_public_requirements_srv_herramientas();
  if jsonb_array_length(r) <> 2 then raise exception 'herramientas: debería haber 2 activas: %', r; end if;
  if r->0->>'slug' <> 'ensayo-a' or r->1->>'slug' <> 'ensayo-b' then raise exception 'herramientas: orden incorrecto: %', r; end if;
  if r->0->>'code_url' is not null or r->0->>'docs_url' <> 'https://example.com/docs' then raise exception 'herramientas: urls: %', r; end if;
  -- upsert: actualiza, no duplica
  perform public.db_public_requirements_srv_upsert_herramienta('ensayo-a', 'Alpha tool 2', 'auth', 'x', null, 'https://example.com/docs', '{}', 'active', 10);
  r := public.db_public_requirements_srv_herramientas();
  if jsonb_array_length(r) <> 2 or r->0->>'name' <> 'Alpha tool 2' then raise exception 'herramientas: el upsert duplica o no actualiza: %', r; end if;
  -- sin ninguna URL, o con una URL que no es https, no entra
  begin
    perform public.db_public_requirements_srv_upsert_herramienta('ensayo-sin', 'No url', 'other', '', null, null, '{}', 'active', 1);
    raise exception 'ha aceptado una herramienta sin url';
  exception when check_violation then null; end;
  begin
    perform public.db_public_requirements_srv_upsert_herramienta('ensayo-http', 'Http url', 'other', '', 'http://example.com', null, '{}', 'active', 1);
    raise exception 'ha aceptado una url http';
  exception when check_violation then null; end;
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
  r := public.db_public_requirements_srv_buscar(null, null, '{saas-b2b}', 5, null, 50)->'items';
  if r->0->>'slug' <> e->>'slug' or r->1->>'slug' <> d->>'slug' or r->2->>'slug' <> c->>'slug' then
    raise exception 'orden priority falla: %', (select jsonb_agg(x->>'slug') from jsonb_array_elements(r) x);
  end if;
  if (r->1->>'copies')::int <> 3 or (r->2->>'copies')::int <> 1 then raise exception 'copies mal en la ficha: %', r; end if;
  -- orden por copiados: D, C, E
  r := public.db_public_requirements_srv_buscar(null, null, '{saas-b2b}', 5, null, 50, 'copies')->'items';
  if r->0->>'slug' <> d->>'slug' or r->1->>'slug' <> c->>'slug' or r->2->>'slug' <> e->>'slug' then
    raise exception 'orden copies falla: %', (select jsonb_agg(x->>'slug') from jsonb_array_elements(r) x);
  end if;
  -- con límite, el orden se aplica antes de cortar
  r := public.db_public_requirements_srv_buscar(null, null, '{saas-b2b}', 5, null, 1, 'copies')->'items';
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


-- ════════════════════════════════════════════════════════════════════════════
--  0006: embeddings con etiquetas (embedding_v) y mapa 2D
-- ════════════════════════════════════════════════════════════════════════════
-- anon y authenticated no pueden llamar a las funciones nuevas
set local role anon;
do $$ begin
  perform public.db_public_requirements_srv_mapa();
  raise exception 'anon ha podido leer el mapa';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role authenticated;
do $$ begin
  perform public.db_public_requirements_srv_guardar_embedding(1, pg_temp.v(1), 2);
  raise exception 'authenticated ha podido guardar un embedding';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from db_public_requirements.mapa_requisito;
  raise exception 'authenticated ha leído mapa_requisito';
exception when insufficient_privilege then null;
end $$;
reset role;

set local role service_role;
select public.db_public_requirements_srv_upsert_categoria('map-app', 'app_type', 'Map app', '', 10);
select public.db_public_requirements_srv_upsert_categoria('map-app-2', 'app_type', 'Second map app', '', 11);
select public.db_public_requirements_srv_upsert_categoria('map-topic', 'cross_cutting', 'Map topic', '', 10);
select public.db_public_requirements_srv_upsert_categoria('map-topic-2', 'cross_cutting', 'Second map topic', '', 11);
select public.db_public_requirements_srv_upsert_categoria('map-soft', 'software_category', 'Map software', '', 10, null, null, null, array['map-app-2']);

do $$
declare a jsonb; b jsonb; c jsonb; d jsonb; r jsonb; p jsonb; m0 timestamptz; n int; pend0 int; v int;
begin
  reset role;   -- las comprobaciones directas sobre tablas (archivar, leer la versión) van como propietario
  a := public.db_public_requirements_srv_crear_requisito('Map item alpha',
    'The product must keep the first mapped requirement for the embedding test.', '["It is mapped"]', 'functional',
    '[{"slug":"map-app","priority":2},{"slug":"map-app-2","priority":1},{"slug":"map-topic","priority":3},{"slug":"map-topic-2","priority":3}]', pg_temp.v(31), null);
  b := public.db_public_requirements_srv_crear_requisito('Map item beta',
    'The product must keep the second mapped requirement for the embedding test.', '[]', 'technical',
    '[{"slug":"map-soft","priority":2}]', pg_temp.v(32), null);
  c := public.db_public_requirements_srv_crear_requisito('Map item gamma',
    'The product must keep a third mapped requirement without any app type.', '[]', 'functional',
    '[{"slug":"map-topic","priority":4}]', pg_temp.v(33), null);
  d := public.db_public_requirements_srv_crear_requisito('Map item without vector',
    'The product must keep a requirement that has no embedding yet for the test.', '[]', 'functional',
    '[{"slug":"map-app","priority":5}]', null, null);

  -- los requisitos nuevos nacen con la versión 2 del texto; los viejos (1) son los que se reembeben
  select embedding_v into v from db_public_requirements.requisito where id = (a->>'id')::bigint;
  if v <> 2 then raise exception 'un requisito nuevo debería nacer con embedding_v 2 (es %)', v; end if;
  update db_public_requirements.requisito set embedding_v = 1 where id in ((a->>'id')::bigint, (d->>'id')::bigint);

  -- srv_requisitos_para_embeber: fichas con categorías, paginado por id y reanudable
  r := public.db_public_requirements_srv_requisitos_para_embeber(2, 0, 200);
  pend0 := (r->>'pending')::int;
  if pend0 < 2 then raise exception 'pending debería contar al menos 2 (es %)', pend0; end if;
  if not exists (select 1 from jsonb_array_elements(r->'items') x
                  where x->>'slug' = a->>'slug' and jsonb_array_length(x->'categories') = 4 and x->'criteria' = '["It is mapped"]'::jsonb)
  then raise exception 'las fichas para embeber no llevan categorías y criterios: %', r->'items'; end if;
  if exists (select 1 from jsonb_array_elements(r->'items') x where x->>'slug' = b->>'slug')
  then raise exception 'lo que ya está en la versión 2 no debe salir'; end if;
  -- paginar: tras el id de a, no sale a
  r := public.db_public_requirements_srv_requisitos_para_embeber(2, (a->>'id')::bigint, 200);
  if exists (select 1 from jsonb_array_elements(r->'items') x where x->>'slug' = a->>'slug')
  then raise exception 'p_despues no pagina'; end if;
  if jsonb_array_length(public.db_public_requirements_srv_requisitos_para_embeber(2, 0, 1)->'items') <> 1
  then raise exception 'p_limite no se respeta'; end if;

  -- guardar el embedding sube la versión, cambia el vector y NO mueve la fecha de actualización
  perform set_config('reqdb.sin_fechas', '', true);
  select (public.db_public_requirements_srv_requisito(a->>'slug')->>'updated_at')::timestamptz into m0;
  perform public.db_public_requirements_srv_guardar_embedding((a->>'id')::bigint, pg_temp.v(34), 2);
  perform public.db_public_requirements_srv_guardar_embedding((d->>'id')::bigint, pg_temp.v(35), 2);
  if (public.db_public_requirements_srv_requisitos_para_embeber(2, 0, 200)->>'pending')::int <> pend0 - 2
  then raise exception 'pending debería bajar en 2'; end if;
  if (select embedding::text from db_public_requirements.requisito where id = (a->>'id')::bigint) <> pg_temp.v(34)
  then raise exception 'el vector no se guardó'; end if;
  if (public.db_public_requirements_srv_requisito(a->>'slug')->>'updated_at')::timestamptz is distinct from m0
  then raise exception 'guardar un embedding no debe mover actualizado_en'; end if;

  -- el mapa: sin coordenadas, no sale nadie
  if (public.db_public_requirements_srv_mapa()->>'count')::int <> 0 then raise exception 'el mapa debería estar vacío'; end if;
  if public.db_public_requirements_srv_mapa_modelo() is not null then raise exception 'no debería haber modelo'; end if;

  -- srv_mapa_para_calcular devuelve vectores
  r := public.db_public_requirements_srv_mapa_para_calcular(0, 200, false);
  if not exists (select 1 from jsonb_array_elements(r->'items') x where (x->>'id')::bigint = (c->>'id')::bigint and x->>'vec' like '[%')
  then raise exception 'mapa_para_calcular no devuelve vectores'; end if;

  -- guardar coordenadas y modelo
  n := public.db_public_requirements_srv_guardar_mapa(jsonb_build_array(
         jsonb_build_object('id', (a->>'id')::bigint, 'x', 0.5, 'y', -0.25),
         jsonb_build_object('id', (b->>'id')::bigint, 'x', -1.0, 'y', 0.75),
         jsonb_build_object('id', 999999999, 'x', 0, 'y', 0)),            -- un id que no existe se ignora
       '{"version":1,"dims":768,"prueba":true}');
  if n <> 2 then raise exception 'guardar_mapa debería escribir 2 puntos (escribió %)', n; end if;
  if public.db_public_requirements_srv_mapa_modelo()->>'prueba' <> 'true' then raise exception 'el modelo no se guardó'; end if;
  -- solo_nuevos: ya no salen a ni b
  r := public.db_public_requirements_srv_mapa_para_calcular(0, 200, true);
  if exists (select 1 from jsonb_array_elements(r->'items') x where (x->>'id')::bigint in ((a->>'id')::bigint, (b->>'id')::bigint))
  then raise exception 'solo_nuevos devuelve lo que ya tiene coordenadas'; end if;
  -- reescribir un punto lo actualiza, no lo duplica
  perform public.db_public_requirements_srv_guardar_mapa(jsonb_build_array(jsonb_build_object('id', (a->>'id')::bigint, 'x', 0.6, 'y', -0.2)));
  perform public.db_public_requirements_srv_guardar_mapa(jsonb_build_array(jsonb_build_object('id', (c->>'id')::bigint, 'x', 1.5, 'y', 0.1)));

  r := public.db_public_requirements_srv_mapa();
  if (r->>'count')::int <> 3 then raise exception 'el mapa debería tener 3 puntos: %', r; end if;
  select x into p from jsonb_array_elements(r->'points') x where x->>'slug' = a->>'slug';
  if round((p->>'x')::numeric, 2) <> 0.6 or round((p->>'y')::numeric, 2) <> -0.2 then raise exception 'coordenadas de alpha: %', p; end if;
  -- el tipo de app principal es el de mejor prioridad (map-app-2, P1); topics solo los transversales; sin enunciado
  if p->>'app_type' <> 'map-app-2' or p->'topics' <> '["map-topic","map-topic-2"]'::jsonb or p->>'kind' <> 'functional'
     or (p->>'priority')::int <> 1 or p ? 'statement' then raise exception 'ficha del mapa de alpha: %', p; end if;
  -- sin tipo de app propio, el primer arquetipo de su categoría de software
  select x into p from jsonb_array_elements(r->'points') x where x->>'slug' = b->>'slug';
  if p->>'app_type' <> 'map-app-2' then raise exception 'app_type heredado de la categoría de software: %', p; end if;
  -- sin ningún tipo de app: null
  select x into p from jsonb_array_elements(r->'points') x where x->>'slug' = c->>'slug';
  if p->'app_type' <> 'null'::jsonb or p->'topics' <> '["map-topic"]'::jsonb then raise exception 'gamma: %', p; end if;

  -- un requisito archivado desaparece del mapa y su punto se limpia al guardar
  update db_public_requirements.requisito set estado = 'archived' where id = (c->>'id')::bigint;
  if (public.db_public_requirements_srv_mapa()->>'count')::int <> 2 then raise exception 'lo archivado no debe salir en el mapa'; end if;
  perform public.db_public_requirements_srv_guardar_mapa('[]');
  if (select count(*) from db_public_requirements.mapa_requisito where requisito_id = (c->>'id')::bigint) <> 0 then
    raise exception 'las coordenadas de un archivado deberían limpiarse'; end if;

  -- validaciones
  begin
    perform public.db_public_requirements_srv_guardar_mapa(jsonb_build_array(jsonb_build_object('id', (a->>'id')::bigint, 'x', 99, 'y', 0)));
    raise exception 'ha aceptado una coordenada fuera de rango';
  exception when check_violation then null; end;
  begin
    perform public.db_public_requirements_srv_guardar_mapa('{"no":"array"}');
    raise exception 'ha aceptado algo que no es un array';
  exception when raise_exception then
    if sqlerrm not like 'p_puntos%' then raise; end if;
  end;
end $$;
reset role;

-- ── 0007 · aportes de tests y aceleradores: registrar, similares, fusionar sin pisar prioridades
set local role service_role;
select public.db_public_requirements_srv_upsert_categoria('rev-cat', 'app_type', 'Revision cat', '', 90);
select public.db_public_requirements_srv_crear_requisito('Revision requirement A', 'The app must do the thing A reliably.', '[]'::jsonb,
  'functional', '[{"slug":"rev-cat","priority":1}]'::jsonb, null, null, null, 'rev-req-a');
select public.db_public_requirements_srv_crear_requisito('Revision requirement B', 'The app must do the thing B reliably.', '[]'::jsonb,
  'functional', '[{"slug":"rev-cat","priority":2}]'::jsonb, null, null, null, 'rev-req-b');
do $$
declare ap bigint; t jsonb; a jsonb; r jsonb; v_prio int; v_cob text; n int;
begin
  reset role;   -- las comprobaciones leen tablas directamente; los permisos de las funciones ya los prueba el contrato
  -- registrar con tipo y propuesta; sin cuenta o con tipo raro falla
  ap := public.db_public_requirements_srv_registrar_propuesta('user_rev', 'test',
    E'Title: Rev test\nScenario: Do A and check the result.', '{"title":"Rev test"}'::jsonb, '{}');
  if (select tipo from db_public_requirements.aporte where id = ap) <> 'test' then raise exception 'el aporte no guarda el tipo'; end if;
  begin perform public.db_public_requirements_srv_registrar_propuesta(null, 'test', 'texto suficiente largo', null, '{}');
    raise exception 'acepta un aporte sin autor';
  exception when others then if sqlerrm not like 'hace falta una cuenta%' then raise; end if; end;
  begin perform public.db_public_requirements_srv_registrar_propuesta('user_rev', 'otro', 'texto suficiente largo', null, '{}');
    raise exception 'acepta un tipo inválido';
  exception when others then if sqlerrm not like 'tipo de aporte inválido%' then raise; end if; end;

  -- test: crear, similares, fusionar (enlace nuevo; la prioridad 1 no se toca)
  t := public.db_public_requirements_srv_crear_test('Rev test reset', 'Do A and verify the result is refused.', 'integration', 1,
         array['rev-req-a'], pg_temp.v(11), 'user_rev', 'rev-test-1');
  perform public.db_public_requirements_srv_enlazar_aporte(ap, 'test', (t->>'id')::bigint);
  r := public.db_public_requirements_srv_similares_tests(pg_temp.v(11), 3);
  if r->0->>'slug' <> 'rev-test-1' or (r->0->>'similarity')::numeric < 0.99 then raise exception 'similares_tests falla: %', r; end if;
  if r->0->>'priority' <> '1' then raise exception 'la ficha del test no trae la prioridad'; end if;
  perform public.db_public_requirements_srv_fusionar_test((t->>'id')::bigint, 'Rev test reset improved', 'Do A twice and verify the second is refused.',
    array['rev-req-b'], pg_temp.v(12), ap);
  select prioridad into v_prio from db_public_requirements.test where slug = 'rev-test-1';
  if v_prio <> 1 then raise exception 'fusionar_test ha cambiado la prioridad'; end if;
  select count(*) into n from db_public_requirements.test_requisito where test_id = (t->>'id')::bigint;
  if n <> 2 then raise exception 'fusionar_test no añade el enlace (n=%)', n; end if;
  if (select estado from db_public_requirements.aporte where id = ap) <> 'merged'
     or (select test_id from db_public_requirements.aporte where id = ap) <> (t->>'id')::bigint then raise exception 'el aporte no queda enlazado al test'; end if;
  begin perform public.db_public_requirements_srv_fusionar_test((t->>'id')::bigint, 'x title', 'ten chars long', array['no-existe'], null, null);
    raise exception 'fusionar_test acepta un requisito inexistente';
  exception when others then if sqlerrm not like 'el requisito%' then raise; end if; end;

  -- acelerador: crear, similares, por URL, fusionar (cobertura existente intacta, plataformas se suman)
  a := public.db_public_requirements_srv_crear_acelerador('Rev Lib', 'A library that helps with the thing A.', 'open_source', 'free',
         'https://rev-lib.dev/', array['javascript'], '[{"slug":"rev-req-a","coverage":"full"}]'::jsonb, pg_temp.v(21), 'user_rev', 'rev-lib');
  r := public.db_public_requirements_srv_similares_aceleradores(pg_temp.v(21), 3);
  if r->0->>'slug' <> 'rev-lib' then raise exception 'similares_aceleradores falla: %', r; end if;
  r := public.db_public_requirements_srv_acelerador_por_url('HTTPS://REV-LIB.dev');
  if r->>'slug' <> 'rev-lib' then raise exception 'acelerador_por_url no casa mayúsculas/barra final: %', r; end if;
  if public.db_public_requirements_srv_acelerador_por_url('https://otra.dev') is not null then raise exception 'acelerador_por_url inventa'; end if;
  ap := public.db_public_requirements_srv_registrar_propuesta('user_rev', 'accelerator', E'Name: Rev Lib\nURL: https://rev-lib.dev', null, '{}');
  perform public.db_public_requirements_srv_fusionar_acelerador((a->>'id')::bigint, 'A better description of the library for A and B.', array['python'],
    '[{"slug":"rev-req-a","coverage":"partial"},{"slug":"rev-req-b","coverage":"partial"}]'::jsonb, pg_temp.v(22), ap);
  select cobertura into v_cob from db_public_requirements.acelerador_requisito ar
    join db_public_requirements.requisito q on q.id = ar.requisito_id where ar.acelerador_id = (a->>'id')::bigint and q.slug = 'rev-req-a';
  if v_cob <> 'full' then raise exception 'fusionar_acelerador ha pisado la cobertura existente (%)', v_cob; end if;
  select count(*) into n from db_public_requirements.acelerador_requisito where acelerador_id = (a->>'id')::bigint;
  if n <> 2 then raise exception 'fusionar_acelerador no añade el enlace'; end if;
  if (select plataformas from db_public_requirements.acelerador where slug = 'rev-lib') <> array['javascript','python'] then
    raise exception 'las plataformas no se suman: %', (select plataformas from db_public_requirements.acelerador where slug = 'rev-lib'); end if;

  -- mis_aportes enseña tipo y slugs de lo creado/fusionado, y solo a su autor
  r := public.db_public_requirements_srv_mis_aportes('user_rev');
  if jsonb_array_length(r) <> 2 or not exists (select 1 from jsonb_array_elements(r) x where x->>'type' = 'test' and x->>'test' = 'rev-test-1')
     or not exists (select 1 from jsonb_array_elements(r) x where x->>'type' = 'accelerator' and x->>'accelerator' = 'rev-lib') then
    raise exception 'mis_aportes no lista los tipos: %', r; end if;
  if jsonb_array_length(public.db_public_requirements_srv_mis_aportes('otra_persona')) <> 0 then raise exception 'mis_aportes filtra a otros'; end if;
end $$;
reset role;


-- ════════════════════════════════════════════════════════════════════════════
--  0008 · zona admin / cuadro de control
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;
do $$ begin
  perform public.db_public_requirements_srv_admin_resumen();
  raise exception 'anon ha podido llamar a srv_admin_resumen';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.db_public_requirements_srv_registrar_eventos('{"read":1}');
  raise exception 'anon ha podido registrar eventos';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role authenticated;
do $$ begin
  perform public.db_public_requirements_srv_admin_auditar('x', 'accion', null, '{}');
  raise exception 'authenticated ha podido escribir en la auditoría';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from db_public_requirements.auditoria;
  raise exception 'authenticated ha leído la auditoría directamente';
exception when insufficient_privilege then null;
end $$;
reset role;

-- todas las funciones admin: solo service_role
do $$
declare f record; n int := 0;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and (p.proname like 'db_public_requirements_srv_admin_%' or p.proname = 'db_public_requirements_srv_registrar_eventos')
  loop
    n := n + 1;
    if has_function_privilege('anon', f.oid, 'execute') or has_function_privilege('authenticated', f.oid, 'execute')
       or has_function_privilege('public', f.oid, 'execute') then raise exception '% es ejecutable por anon/authenticated/public', f.proname; end if;
    if not has_function_privilege('service_role', f.oid, 'execute') then raise exception '% no es ejecutable por service_role', f.proname; end if;
  end loop;
  if n < 17 then raise exception 'esperaba al menos 17 funciones admin y hay %', n; end if;
end $$;

-- (como superusuario: aquí se leen tablas directamente; los permisos de las funciones ya se comprobaron arriba)
do $$
declare r jsonb; a jsonb; id1 bigint; id2 bigint; id3 bigint; s1 bigint; s2 bigint; n int; sal constant text := 'sal-ensayo';
        req jsonb; part text; nuevo_a jsonb; t1 jsonb; ap1 bigint; ap2 bigint; ap3 bigint; sub1 constant text := 'user_secreto_uno';
begin
  -- ── contadores de actividad: suman por día, ignoran claves raras y tienen tope
  perform public.db_public_requirements_srv_registrar_eventos('{"read": 3, "search": 2, "NO VALE": 5, "x": 1, "copy": -4, "list": "texto"}');
  perform public.db_public_requirements_srv_registrar_eventos('{"read": 4}');
  perform public.db_public_requirements_srv_registrar_eventos(null);
  perform public.db_public_requirements_srv_registrar_eventos('[1,2]');
  select d.n into n from db_public_requirements.actividad_diaria d where d.dia = current_date and d.metrica = 'read';
  if n <> 7 then raise exception 'read debería sumar 7, es %', n; end if;
  if exists (select 1 from db_public_requirements.actividad_diaria where metrica in ('NO VALE', 'x', 'copy', 'list')) then
    raise exception 'ha guardado métricas inválidas'; end if;
  perform public.db_public_requirements_srv_registrar_eventos('{"big": 99999999999}');
  select d.n into n from db_public_requirements.actividad_diaria d where d.metrica = 'big';
  if n <> 1000000 then raise exception 'sin tope por evento: %', n; end if;

  -- ── serie de actividad: un elemento por día, con lo derivado de las tablas
  r := public.db_public_requirements_srv_admin_actividad(30);
  if jsonb_array_length(r) <> 30 then raise exception 'la serie de 30 días tiene % elementos', jsonb_array_length(r); end if;
  if jsonb_array_length(public.db_public_requirements_srv_admin_actividad(90)) <> 90 then raise exception 'la serie de 90 días falla'; end if;
  if jsonb_array_length(public.db_public_requirements_srv_admin_actividad(9999)) <> 365 then raise exception 'el tope de 365 días falla'; end if;
  if (r->29->>'day')::date <> current_date then raise exception 'el último día no es hoy'; end if;
  if (r->29->'counters'->>'read')::int <> 7 then raise exception 'contador read no sale en la serie: %', r->29; end if;

  -- ── aportes: línea de tiempo con filtros, hash de autor, paginación
  ap1 := public.db_public_requirements_srv_registrar_aporte(sub1, 'Users can pin messages to the top of a chat.', '{messaging}');
  ap2 := public.db_public_requirements_srv_registrar_aporte(sub1, 'Segundo aporte de ensayo con texto suficiente.', '{}');
  ap3 := public.db_public_requirements_srv_registrar_aporte('user_secreto_dos', 'Tercer aporte de ensayo con texto suficiente.', '{}');
  perform public.db_public_requirements_srv_resolver_aporte(ap1, 'needs_human',
    '{"items":[{"action":"needs_human","reason":"low confidence","item":{"title":"Pin messages","statement":"Users can pin messages to the top of a conversation.","criteria":["A pinned message stays on top"],"kind":"functional","categories":[{"slug":"messaging","priority":3}]}}]}');
  perform public.db_public_requirements_srv_resolver_aporte(ap2, 'rejected', '{"items":[],"reason":"spam"}');
  perform public.db_public_requirements_srv_resolver_aporte(ap3, 'needs_human', '{"items":[{"action":"needs_human","reason":"sin item"}]}');

  r := public.db_public_requirements_srv_admin_aportes(null, null, null, sal, 50, null);
  if jsonb_array_length(r->'items') < 3 then raise exception 'faltan aportes en la línea de tiempo'; end if;
  if (r->'items'->0->>'id')::bigint <> ap3 then raise exception 'orden: el más reciente primero'; end if;
  if r::text like '%' || sub1 || '%' or r::text like '%user_secreto_dos%' then raise exception 'la línea de tiempo filtra un sub en claro'; end if;
  if (r->'items'->1->>'who') <> db_public_requirements.hash_corto(sub1, sal) then raise exception 'hash de autor inesperado'; end if;
  if length(r->'items'->1->>'who') <> 10 then raise exception 'el hash debe ser corto'; end if;
  if jsonb_array_length(public.db_public_requirements_srv_admin_aportes('needs_human', null, null, sal, 50, null)->'items') <> 2 then
    raise exception 'filtro por estado falla'; end if;
  if jsonb_array_length(public.db_public_requirements_srv_admin_aportes(null, null, db_public_requirements.hash_corto(sub1, sal), sal, 50, null)->'items') <> 2 then
    raise exception 'filtro por persona (hash) falla'; end if;
  r := public.db_public_requirements_srv_admin_aportes(null, null, null, sal, 2, null);
  if jsonb_array_length(r->'items') <> 2 or (r->>'next') is null then raise exception 'paginación: %', r; end if;
  if jsonb_array_length(public.db_public_requirements_srv_admin_aportes(null, null, null, sal, 2, (r->>'next')::bigint)->'items') < 1 then
    raise exception 'la segunda página está vacía'; end if;
  if jsonb_array_length(public.db_public_requirements_srv_admin_aportes(null, 'no-existe-este-slug', null, sal, 50, null)->'items') <> 0 then
    raise exception 'filtro por requisito falla'; end if;

  -- reclamar: solo un aporte en needs_human, y solo una vez
  r := public.db_public_requirements_srv_admin_aporte_reclamar(ap1);
  if r is null or r->>'author' <> sub1 or r->'verdict'->'items'->0->'item'->>'title' <> 'Pin messages' then raise exception 'reclamar no devuelve el aporte: %', r; end if;
  if public.db_public_requirements_srv_admin_aporte_reclamar(ap1) is not null then raise exception 'se ha podido reclamar dos veces'; end if;
  if public.db_public_requirements_srv_admin_aporte_reclamar(ap2) is not null then raise exception 'se ha reclamado un aporte rechazado'; end if;
  -- el aporte aprobado se resuelve con las funciones de siempre: crear_requisito con p_aporte_id lo enlaza
  nuevo_a := public.db_public_requirements_srv_crear_requisito('Pin messages', 'Users can pin messages to the top of a conversation.', '["A pinned message stays on top"]',
    'functional', '[{"slug":"messaging","priority":3}]', pg_temp.v(40), sub1, ap1);
  perform public.db_public_requirements_srv_resolver_aporte(ap1, 'created', r->'verdict', (nuevo_a->>'id')::bigint);
  r := public.db_public_requirements_srv_admin_aportes('created', nuevo_a->>'slug', null, sal, 50, null);
  if jsonb_array_length(r->'items') <> 1 or r->'items'->0->>'requirement' <> nuevo_a->>'slug' then raise exception 'filtro por requisito creado: %', r; end if;

  -- ── sugerencias: cola y cambio de estado con auditoría
  s1 := public.db_public_requirements_srv_sugerir('user_sug_uno', 'feature', 'app', null, 'Please add a way to unpin messages in the app.');
  s2 := public.db_public_requirements_srv_sugerir('user_sug_dos', 'problem', 'app', null, 'Something is odd in the filters on mobile.');
  r := public.db_public_requirements_srv_admin_sugerencias('new', sal, 50, null);
  if jsonb_array_length(r) <> 2 or r::text like '%user_sug_uno%' then raise exception 'cola de sugerencias: %', r; end if;
  if not public.db_public_requirements_srv_admin_sugerencia_estado(s1, 'accepted', 'abcdef1234') then raise exception 'no cambió la sugerencia'; end if;
  if public.db_public_requirements_srv_admin_sugerencia_estado(999999, 'accepted', 'abcdef1234') then raise exception 'sugerencia inexistente'; end if;
  begin perform public.db_public_requirements_srv_admin_sugerencia_estado(s1, 'borrada', 'abcdef1234'); raise exception 'ha aceptado un estado inválido';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;
  if jsonb_array_length(public.db_public_requirements_srv_admin_sugerencias('new', sal, 50, null)) <> 1 then raise exception 'la sugerencia aceptada sigue en nuevas'; end if;
  if jsonb_array_length(public.db_public_requirements_srv_admin_sugerencias('accepted', sal, 50, null)) <> 1 then raise exception 'falta en aceptadas'; end if;

  -- ── historial de versiones
  perform public.db_public_requirements_srv_fusionar((nuevo_a->>'id')::bigint, 'Pin messages in a chat', 'Users can pin messages to the top of a chat and unpin them.',
    '["A pinned message stays on top","Unpinning removes it"]', '[]', pg_temp.v(40), null);
  r := public.db_public_requirements_srv_admin_versiones(nuevo_a->>'slug');
  if r->'current'->>'title' <> 'Pin messages in a chat' or (r->'current'->>'version')::int <> 2
     or jsonb_array_length(r->'versions') <> 1 or r->'versions'->0->>'title' <> 'Pin messages' then raise exception 'historial: %', r; end if;
  if public.db_public_requirements_srv_admin_versiones('no-existe') is not null then raise exception 'historial de un requisito inexistente'; end if;

  -- ── candidatos a partir + propuesta de división
  req := public.db_public_requirements_srv_crear_requisito('Manage projects and teams end to end',
    'Users can create, edit, archive and delete projects, invite teammates, assign roles, export reports and receive notifications when anything changes in the workspace.',
    '["Create a project","Edit a project","Archive a project","Delete a project","Invite a teammate","Assign a role","Export a report"]', 'functional',
    '[{"slug":"messaging","priority":2},{"slug":"security","priority":1}]', pg_temp.v(41), 'user_autor_largo');
  t1 := public.db_public_requirements_srv_crear_test('Projects can be created and archived', 'Create a project, archive it and check it disappears from the list.', 'e2e', 2,
    array[req->>'slug'], pg_temp.v(42));
  perform public.db_public_requirements_srv_crear_acelerador('Team Kit', 'Open source toolkit for teams, roles and invitations in apps.', 'open_source', 'free',
    'https://example.com/team-kit', '{javascript}', jsonb_build_array(jsonb_build_object('slug', req->>'slug', 'coverage', 'partial')), pg_temp.v(43));
  r := public.db_public_requirements_srv_admin_candidatos(300);
  select x into a from jsonb_array_elements(r) x where x->>'slug' = req->>'slug';
  if a is null or (a->>'criteria_count')::int <> 7 or (a->>'categories_count')::int <> 2 or (a->>'tests_count')::int <> 1
     or (a->>'accelerators_count')::int <> 1 or a->>'statement' is null then raise exception 'métricas del candidato: %', a; end if;
  if r->0->>'slug' <> req->>'slug' then raise exception 'el más voluminoso debería ir primero, va %', r->0->>'slug'; end if;

  id1 := public.db_public_requirements_srv_admin_propuesta_crear(req->>'slug',
    '[{"title":"Create and edit projects","statement":"Users can create and edit projects.","criteria":["Create a project","Edit a project"]},
      {"title":"Archive and delete projects","statement":"Users can archive and delete projects.","criteria":["Archive a project","Delete a project"]},
      {"title":"Invite teammates","statement":"Users can invite teammates and assign them roles.","criteria":["Invite a teammate","Assign a role"]}]',
    'Three independent behaviours', 77, 'modelo-de-ensayo', 'abcdef1234');
  -- una segunda propuesta del mismo requisito sustituye a la pendiente
  id2 := public.db_public_requirements_srv_admin_propuesta_crear(req->>'slug',
    '[{"title":"Create and edit projects","statement":"Users can create and edit projects.","criteria":["Create a project"]},
      {"title":"Everything else about projects","statement":"Users can archive, delete and share projects.","criteria":["Archive a project"]}]',
    'Two parts', 70, 'modelo-de-ensayo', 'abcdef1234');
  if id2 = id1 then raise exception 'el id de la propuesta debería cambiar'; end if;
  if jsonb_array_length(public.db_public_requirements_srv_admin_propuestas('pending', 50)) <> 1 then raise exception 'debe haber UNA propuesta pendiente por requisito'; end if;
  if (select x->>'proposal' from jsonb_array_elements(public.db_public_requirements_srv_admin_candidatos(300)) x where x->>'slug' = req->>'slug') <> id2::text then
    raise exception 'el candidato no marca su propuesta pendiente'; end if;
  -- la propuesta NO ha tocado el requisito
  if (select estado from db_public_requirements.requisito where slug = req->>'slug') <> 'published' then raise exception 'proponer no debe archivar'; end if;
  begin perform public.db_public_requirements_srv_admin_propuesta_crear(req->>'slug', '[{"title":"solo una","statement":"Una sola parte no vale","criteria":[]}]', '', 1, 'm', 'abcdef1234');
        raise exception 'ha aceptado una sola parte';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;
  begin perform public.db_public_requirements_srv_admin_propuesta_crear('no-existe-este-slug', '[{},{}]', '', 1, 'm', 'abcdef1234'); raise exception 'ha aceptado un requisito inexistente';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;

  -- descartar y volver a proponer
  if not public.db_public_requirements_srv_admin_propuesta_descartar(id2, 'abcdef1234') then raise exception 'no descartó'; end if;
  if public.db_public_requirements_srv_admin_propuesta_descartar(id2, 'abcdef1234') then raise exception 'descartó dos veces'; end if;
  id3 := public.db_public_requirements_srv_admin_propuesta_crear(req->>'slug',
    '[{"title":"Create and edit projects","statement":"Users can create and edit projects.","criteria":["Create a project","Edit a project"]},
      {"title":"Archive and delete projects","statement":"Users can archive and delete projects.","criteria":["Archive a project","Delete a project"]}]',
    'Two behaviours', 72, 'modelo-de-ensayo', 'abcdef1234');

  -- aceptar: crea las partes con las MISMAS prioridades, enlaza tests y aceleradores, archiva el original
  r := public.db_public_requirements_srv_admin_propuesta_aceptar(id3, jsonb_build_array(pg_temp.v(44), null), 'abcdef1234');
  if jsonb_array_length(r->'created') <> 2 or r->>'archived' <> req->>'slug' then raise exception 'aceptar devuelve %', r; end if;
  if (select estado from db_public_requirements.requisito where slug = req->>'slug') <> 'archived' then raise exception 'el original no quedó archivado'; end if;
  if public.db_public_requirements_srv_requisito(req->>'slug') is not null then raise exception 'el original archivado sigue público'; end if;
  for part in select jsonb_array_elements_text(r->'created') loop
    a := public.db_public_requirements_srv_requisito(part);
    if a is null or a->>'kind' <> 'functional' then raise exception 'parte mal creada: %', a; end if;
    if (select array_agg((c->>'slug') || ':' || (c->>'priority') order by c->>'slug') from jsonb_array_elements(a->'categories') c)
         <> array['messaging:2', 'security:1'] then raise exception 'las prioridades no se conservaron: %', a->'categories'; end if;
  end loop;
  select count(*) into n from db_public_requirements.test_requisito tr join db_public_requirements.requisito r2 on r2.id = tr.requisito_id
   where r2.slug = any (array(select jsonb_array_elements_text(r->'created')));
  if n <> 2 then raise exception 'el test debería estar enlazado a las 2 partes, está en %', n; end if;
  select count(*) into n from db_public_requirements.acelerador_requisito ar join db_public_requirements.requisito r2 on r2.id = ar.requisito_id
   where r2.slug = any (array(select jsonb_array_elements_text(r->'created')));
  if n <> 2 then raise exception 'el acelerador debería estar enlazado a las 2 partes, está en %', n; end if;
  if (select resultado->>'archived' from db_public_requirements.propuesta_division where id = id3) <> req->>'slug'
     or (select estado from db_public_requirements.propuesta_division where id = id3) <> 'accepted' then raise exception 'la propuesta no quedó aceptada'; end if;
  begin perform public.db_public_requirements_srv_admin_propuesta_aceptar(id3, '[]', 'abcdef1234'); raise exception 'aceptó dos veces';
  exception when raise_exception then if sqlerrm like 'aceptó%' then raise; end if; end;
  if jsonb_array_length(public.db_public_requirements_srv_admin_propuestas('accepted', 50)) <> 1 then raise exception 'falta la propuesta aceptada'; end if;

  -- ── paneles y resumen
  update db_public_requirements.requisito set copias = 99 where slug = nuevo_a->>'slug';
  r := public.db_public_requirements_srv_admin_paneles();
  if r->'top_copied'->0->>'slug' <> nuevo_a->>'slug' then raise exception 'top copiados: %', r->'top_copied'; end if;
  if (r->'without_tests'->>'count')::int < 1 or jsonb_typeof(r->'without_tests'->'items') <> 'array' then raise exception 'sin tests: %', r->'without_tests'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'without_tests'->'items') x where x->>'slug' = nuevo_a->>'slug') then raise exception 'sin tests no incluye uno sin tests'; end if;
  if exists (select 1 from jsonb_array_elements(r->'without_tests'->'items') x where x->>'slug' = req->>'slug') then raise exception 'sin tests incluye un archivado'; end if;
  if jsonb_typeof(r->'without_accelerators'->'items') <> 'array' or jsonb_typeof(r->'empty_categories'->'items') <> 'array' then raise exception 'paneles: %', r; end if;
  perform public.db_public_requirements_srv_upsert_categoria('empty-cat-ensayo', 'cross_cutting', 'Empty category', '', 99);
  if not exists (select 1 from jsonb_array_elements(public.db_public_requirements_srv_admin_paneles()->'empty_categories'->'items') x where x->>'slug' = 'empty-cat-ensayo') then
    raise exception 'categorías sin contenido no incluye la vacía'; end if;

  r := public.db_public_requirements_srv_admin_resumen();
  if (r->'requirements'->>'published')::int < 5 or (r->'requirements'->>'archived')::int < 1 or (r->>'database_bytes')::bigint <= 0
     or jsonb_array_length(r->'tables') < 15 or (r->'contributions'->>'needs_human')::int <> 1 or (r->>'copies_total')::int < 99 then raise exception 'resumen: %', r; end if;
  if not exists (select 1 from jsonb_array_elements(r->'tables') x where x->>'name' = 'requisito' and (x->>'rows')::int >= 5 and (x->>'bytes')::bigint > 0) then
    raise exception 'resumen: tabla requisito mal contada'; end if;

  -- ── auditoría: quedó constancia de lo que cambió datos y nunca hay un sub en claro
  r := public.db_public_requirements_srv_admin_auditoria(50);
  if (select count(*) from jsonb_array_elements(r) x where x->>'action' = 'split_accepted') <> 1
     or (select count(*) from jsonb_array_elements(r) x where x->>'action' = 'split_proposed') <> 3
     or (select count(*) from jsonb_array_elements(r) x where x->>'action' = 'split_dismissed') <> 1
     or (select count(*) from jsonb_array_elements(r) x where x->>'action' = 'suggestion_status') <> 1 then raise exception 'auditoría incompleta: %', r; end if;
  if r::text like '%user_%' then raise exception 'la auditoría lleva un sub en claro'; end if;
  perform public.db_public_requirements_srv_admin_auditar('abcdef1234', 'contribution_approved', 'contribution:1', '{"applied":1}');
  if public.db_public_requirements_srv_admin_auditoria(1)->0->>'action' <> 'contribution_approved' then raise exception 'auditar no escribe'; end if;
end $$;


-- ═══ 0009: métricas de los aceleradores (estrellas, descargas, proceso de refresco)
set local role service_role;
do $$
declare
  r jsonb; v0 timestamptz; v1 timestamptz; v_ahora timestamptz := now() + interval '1 minute';
begin
  -- sin origen no hay nada que refrescar
  r := public.db_public_requirements_srv_metricas_pendientes(10, v_ahora);
  if jsonb_array_length(r) <> 0 then raise exception 'sin origen no debería haber pendientes: %', r; end if;

  -- fijar el origen: valida formatos
  perform public.db_public_requirements_srv_fijar_origen('lucia-auth', 'https://github.com/lucia-auth/lucia', 'npm', '@scope/lucia');
  perform public.db_public_requirements_srv_fijar_origen('realtime-cloud', null, 'pypi', 'realtime-cloud');
  begin
    perform public.db_public_requirements_srv_fijar_origen('lucia-auth', 'http://github.com/x/y', null, null);
    raise exception 'ha aceptado un repo_url http';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_fijar_origen('lucia-auth', null, 'npm', 'Bad Name With Spaces');
    raise exception 'ha aceptado un nombre de paquete inválido';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_fijar_origen('lucia-auth', null, 'npm', null);
    raise exception 'ha aceptado registro sin paquete';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_fijar_origen('lucia-auth', null, 'cobol', 'x');
    raise exception 'ha aceptado un registro desconocido';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_fijar_origen('no-existe', null, null, null);
    raise exception 'ha aceptado un acelerador inexistente';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;
  -- la restricción de la tabla también vale (no solo la función)
  reset role;
  begin
    update db_public_requirements.acelerador set paquete = 'solo-paquete', registro = null where slug = 'lucia-auth';
    raise exception 'ha aceptado paquete sin registro';
  exception when check_violation then null; end;
  set local role service_role;

  -- pendientes: los dos, el nunca intentado primero (ambos nulos: por id)
  r := public.db_public_requirements_srv_metricas_pendientes(10, v_ahora);
  if jsonb_array_length(r) <> 2 or r->0->>'slug' <> 'lucia-auth' or r->0->>'registry' <> 'npm' then
    raise exception 'pendientes mal: %', r;
  end if;

  -- guardar métricas: no mueve la fecha de contenido
  reset role;
  update db_public_requirements.acelerador set actualizado_en = now() - interval '10 days' where slug = 'lucia-auth';
  select actualizado_en into v0 from db_public_requirements.acelerador where slug = 'lucia-auth';
  perform set_config('reqdb.sin_fechas', '', true);
  set local role service_role;
  perform public.db_public_requirements_srv_guardar_metricas('lucia-auth',
    '{"stars": 12345, "forks": 321, "archived": false, "last_commit": "2026-11-01T10:00:00Z", "downloads_month": 987654, "source": "github+npm"}');
  reset role;
  select actualizado_en into v1 from db_public_requirements.acelerador where slug = 'lucia-auth';
  set local role service_role;
  if v1 <> v0 then raise exception 'refrescar métricas movió actualizado_en'; end if;

  r := public.db_public_requirements_srv_acelerador('lucia-auth');
  if (r->>'stars')::int <> 12345 or (r->>'downloads_month')::int <> 987654 or r->>'registry' <> 'npm'
     or r->>'metrics_source' <> 'github+npm' or r->'metrics_updated_at' = 'null'::jsonb or (r->>'archived')::boolean then
    raise exception 'ficha sin métricas: %', r;
  end if;

  -- un intento con error conserva los datos y anota el error; el siguiente OK lo borra
  perform public.db_public_requirements_srv_guardar_metricas('lucia-auth', '{"error": "npm: not found"}');
  r := public.db_public_requirements_srv_acelerador('lucia-auth');
  if (r->>'stars')::int <> 12345 then raise exception 'un error borró las estrellas: %', r; end if;
  reset role;
  if (select metricas_error from db_public_requirements.acelerador where slug = 'lucia-auth') <> 'npm: not found' then
    raise exception 'error sin anotar';
  end if;
  set local role service_role;
  perform public.db_public_requirements_srv_guardar_metricas('lucia-auth', '{"stars": 12400}');
  reset role;
  if (select metricas_error from db_public_requirements.acelerador where slug = 'lucia-auth') is not null then
    raise exception 'el error no se borró tras un refresco bueno';
  end if;
  set local role service_role;
  begin
    perform public.db_public_requirements_srv_guardar_metricas('lucia-auth', '{"stars": -3}');
    raise exception 'ha aceptado estrellas negativas';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;
  begin
    perform public.db_public_requirements_srv_guardar_metricas('lucia-auth', '{"stars": 1.5}');
    raise exception 'ha aceptado estrellas fraccionarias';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;

  -- reanudable: lo intentado ya no está pendiente con umbral «hace 14 días»; el otro sí
  r := public.db_public_requirements_srv_metricas_pendientes(10, now() - interval '14 days');
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> 'realtime-cloud' then raise exception 'reanudación mal: %', r; end if;
  -- y con umbral futuro vuelven los dos, el más atrasado (nunca intentado) primero
  r := public.db_public_requirements_srv_metricas_pendientes(10, v_ahora);
  if jsonb_array_length(r) <> 2 or r->0->>'slug' <> 'realtime-cloud' then raise exception 'orden por antigüedad mal: %', r; end if;
  r := public.db_public_requirements_srv_metricas_resumen(now() - interval '14 days');
  if (r->>'with_source')::int <> 2 or (r->>'pending')::int <> 1 then raise exception 'resumen mal: %', r; end if;

  -- orden por popularidad (el que tiene datos va primero aunque cubra menos requisitos) y ordenes inválidos
  r := public.db_public_requirements_srv_buscar_aceleradores(null, null, null, null, null, 50, 'popularity');
  if r->0->>'slug' <> 'lucia-auth' then raise exception 'orden por popularidad mal: %', r; end if;
  r := public.db_public_requirements_srv_buscar_aceleradores(null, null, null, null, null, 50);
  if not exists (select 1 from jsonb_array_elements(r) x where x->>'slug' = 'realtime-cloud') then raise exception 'sin orden debería devolver la lista: %', r; end if;
  begin
    perform public.db_public_requirements_srv_buscar_aceleradores(null, null, null, null, null, 50, 'stars');
    raise exception 'ha aceptado un orden inválido';
  exception when raise_exception then if sqlerrm like 'ha aceptado%' then raise; end if; end;

  -- relacionados trae la popularidad
  r := public.db_public_requirements_srv_relacionados('{password-reset-by-email-link}', false, 5, true);
  if not exists (select 1 from jsonb_array_elements(r->'password-reset-by-email-link'->'accelerators') x
                  where x->>'slug' = 'lucia-auth' and (x->>'stars')::int = 12400 and x->>'registry' = 'npm') then
    raise exception 'relacionados sin métricas: %', r;
  end if;

  -- un acelerador archivado no se refresca
  reset role;
  update db_public_requirements.acelerador set estado = 'archived' where slug = 'realtime-cloud';
  set local role service_role;
  r := public.db_public_requirements_srv_metricas_pendientes(10, v_ahora);
  if jsonb_array_length(r) <> 1 then raise exception 'un archivado no debe refrescarse: %', r; end if;

  -- aceleradores_origen pagina por id
  r := public.db_public_requirements_srv_aceleradores_origen(0, 1);
  if jsonb_array_length(r) <> 1 then raise exception 'paginación del origen mal: %', r; end if;
end $$;
reset role;

-- anon y authenticated siguen sin poder llamar a las funciones nuevas
set local role anon;
do $$ begin
  perform public.db_public_requirements_srv_metricas_pendientes(1, now());
  raise exception 'anon ha podido llamar a srv_metricas_pendientes';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role authenticated;
do $$ begin
  perform public.db_public_requirements_srv_guardar_metricas('lucia-auth', '{"stars": 1}');
  raise exception 'authenticated ha podido guardar métricas';
exception when insufficient_privilege then null;
end $$;
reset role;


-- ═══ 0011: jurisdicciones (país), matiz y fuente por país ═══
set role service_role;
select public.db_public_requirements_srv_upsert_categoria('gambling-x', 'app_type', 'Gambling test', '', 90);
select public.db_public_requirements_srv_upsert_jurisdiccion('ES-CT', 'region', 'Catalonia', 'ES', 30);
select public.db_public_requirements_srv_crear_requisito('Generic requirement for any country', 'The system must log every sign-in attempt for later audit.', '["Attempts are logged.", "Logs are kept."]'::jsonb, 'technical', '[{"slug":"gambling-x","priority":2}]'::jsonb, null, null, null, 'pais-generico');
select public.db_public_requirements_srv_crear_requisito('Spain and EU requirement', 'The operator must verify the player identity before activating the account.', '["Identity verified.", "Unverified cannot play."]'::jsonb, 'functional', '[{"slug":"gambling-x","priority":1}]'::jsonb, null, null, null, 'pais-es-ue');
select public.db_public_requirements_srv_crear_requisito('Spain only requirement', 'The operator must cap deposits at the regulated maximum amounts.', '["Cap enforced.", "Cap is configurable."]'::jsonb, 'functional', '[{"slug":"gambling-x","priority":1}]'::jsonb, null, null, null, 'pais-solo-es');
select public.db_public_requirements_srv_asociar_jurisdiccion('pais-es-ue', 'EU', 'EU baseline.', 'GDPR', 'https://eur-lex.europa.eu/eli/reg/2016/679/oj', '2016-04-27');
select public.db_public_requirements_srv_asociar_jurisdiccion('pais-es-ue', 'ES', 'Spanish detail A.', 'Ley X art. 1', 'https://www.boe.es/x', '2026-01-01');
select public.db_public_requirements_srv_asociar_jurisdiccion('pais-solo-es', 'ES', 'EUR 600 per day.', 'RD 1614/2011', 'https://www.boe.es/y', '2026-06-25', current_date + 30);
do $$
declare r jsonb; j jsonb;
begin
  -- sin país: igual que antes, salen los tres
  r := public.db_public_requirements_srv_buscar(null, null, array['gambling-x'], 5, null, 50)->'items';
  if jsonb_array_length(r) <> 3 then raise exception 'sin país deben salir 3, salen %', jsonb_array_length(r); end if;
  -- ES (ya expandido a ES y EU): los tres (el genérico sigue)
  r := public.db_public_requirements_srv_buscar(null, null, array['gambling-x'], 5, null, 50, null, array['ES','EU'], false)->'items';
  if jsonb_array_length(r) <> 3 then raise exception 'ES: deben salir 3'; end if;
  -- solo lo específico de ES: quita el genérico
  r := public.db_public_requirements_srv_buscar(null, null, array['gambling-x'], 5, null, 50, null, array['ES','EU'], true)->'items';
  if jsonb_array_length(r) <> 2 then raise exception 'ES solo: deben salir 2'; end if;
  -- otro país sin datos: solo el genérico; con solo país, ninguno
  r := public.db_public_requirements_srv_buscar(null, null, array['gambling-x'], 5, null, 50, null, array['US'], false)->'items';
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> 'pais-generico' then raise exception 'US: solo el genérico'; end if;
  r := public.db_public_requirements_srv_buscar(null, null, array['gambling-x'], 5, null, 50, null, array['US'], true)->'items';
  if jsonb_array_length(r) <> 0 then raise exception 'US solo: ninguno'; end if;
  -- solo UE: el requisito de ES y UE aparece, el solo-ES no
  r := public.db_public_requirements_srv_buscar(null, null, array['gambling-x'], 5, null, 50, null, array['EU'], true)->'items';
  if jsonb_array_length(r) <> 1 or r->0->>'slug' <> 'pais-es-ue' then raise exception 'EU solo: solo es-ue'; end if;

  -- matices: solo los de lo pedido
  j := public.db_public_requirements_srv_jurisdicciones_de(array['pais-es-ue','pais-solo-es','pais-generico'], array['ES']);
  if jsonb_array_length(j->'pais-es-ue'->'matches') <> 1 or j->'pais-es-ue'->'matches'->0->>'note' <> 'Spanish detail A.' then raise exception 'matiz mal: %', j; end if;
  if jsonb_array_length(j->'pais-generico'->'all') <> 0 then raise exception 'el genérico no lleva jurisdicciones'; end if;
  if j->'pais-solo-es'->'matches'->0->>'status' <> 'upcoming' then raise exception 'en vigor futuro debe ser upcoming'; end if;
  -- sin país: ningún matiz, pero sí los códigos
  j := public.db_public_requirements_srv_jurisdicciones_de(array['pais-es-ue'], null);
  if jsonb_array_length(j->'pais-es-ue'->'matches') <> 0 or jsonb_array_length(j->'pais-es-ue'->'all') <> 2 then raise exception 'sin país mal: %', j; end if;

  -- idempotente: repetir actualiza el matiz sin duplicar
  perform public.db_public_requirements_srv_asociar_jurisdiccion('pais-es-ue', 'ES', 'Spanish detail B.', 'Ley X art. 1', 'https://www.boe.es/x', '2026-01-01');
  j := public.db_public_requirements_srv_jurisdicciones_de(array['pais-es-ue'], array['ES']);
  if j->'pais-es-ue'->'matches'->0->>'note' <> 'Spanish detail B.' or jsonb_array_length(j->'pais-es-ue'->'all') <> 2 then raise exception 'reasociar mal'; end if;

  -- lista con recuentos y jerarquía
  j := public.db_public_requirements_srv_jurisdicciones();
  if not exists (select 1 from jsonb_array_elements(j) x where x->>'code' = 'ES' and (x->>'requirements')::int = 2 and x->>'parent' = 'EU') then raise exception 'lista de jurisdicciones mal: %', j; end if;
  if not exists (select 1 from jsonb_array_elements(j) x where x->>'code' = 'ES-CT' and x->>'parent' = 'ES') then raise exception 'falta la región'; end if;

  -- errores: jurisdicción o requisito inexistente; URL no https
  begin perform public.db_public_requirements_srv_asociar_jurisdiccion('pais-es-ue', 'ZZ', 'x note here'); raise exception 'debía fallar'; exception when others then if sqlerrm = 'debía fallar' then raise; end if; end;
  begin perform public.db_public_requirements_srv_asociar_jurisdiccion('no-existe-slug', 'ES', 'x note here'); raise exception 'debía fallar'; exception when others then if sqlerrm = 'debía fallar' then raise; end if; end;
  begin perform public.db_public_requirements_srv_asociar_jurisdiccion('pais-es-ue', 'ES', 'x note here', 'n', 'http://x.es/a'); raise exception 'debía fallar'; exception when others then if sqlerrm = 'debía fallar' then raise; end if; end;
end $$;

-- anon no puede llamar a las funciones nuevas
set role anon;
do $$ begin
  begin perform public.db_public_requirements_srv_jurisdicciones(); raise exception 'anon no debía poder'; exception when insufficient_privilege then null; end;
  begin perform public.db_public_requirements_srv_jurisdicciones_de(array['x'], null); raise exception 'anon no debía poder'; exception when insufficient_privilege then null; end;
end $$;
reset role;


-- ═══ 0012: alcance de las transversales y paginación ═══
set role service_role;
select public.db_public_requirements_srv_upsert_categoria('alc-juego', 'app_type', 'Game (scope test)', '', 91);
select public.db_public_requirements_srv_upsert_categoria('alc-clinica', 'app_type', 'Clinic (scope test)', '', 92);
select public.db_public_requirements_srv_upsert_categoria('alc-seguridad', 'cross_cutting', 'Security (scope test)', '', 93);
-- uno del juego, uno genérico de seguridad, uno de seguridad de la clínica y uno regulatorio de seguridad del juego (ES)
select public.db_public_requirements_srv_crear_requisito('Scope: game sync', 'The system must keep the game state in sync.', '["a b c d e", "f g h i j"]'::jsonb, 'technical', '[{"slug":"alc-juego","priority":1}]'::jsonb, null, null, null, 'alc-juego-sync');
select public.db_public_requirements_srv_crear_requisito('Scope: generic hashing', 'The system must hash stored passwords.', '["a b c d e", "f g h i j"]'::jsonb, 'technical', '[{"slug":"alc-seguridad","priority":1}]'::jsonb, null, null, null, 'alc-generico');
select public.db_public_requirements_srv_crear_requisito('Scope: clinic records', 'The system must encrypt patient records.', '["a b c d e", "f g h i j"]'::jsonb, 'technical', '[{"slug":"alc-clinica","priority":1},{"slug":"alc-seguridad","priority":1}]'::jsonb, null, null, null, 'alc-clinica-cifrado');
select public.db_public_requirements_srv_crear_requisito('Scope: regulated game logs', 'The operator must keep gaming logs.', '["a b c d e", "f g h i j"]'::jsonb, 'technical', '[{"slug":"alc-juego","priority":2},{"slug":"alc-seguridad","priority":1}]'::jsonb, null, null, null, 'alc-juego-regulado');
select public.db_public_requirements_srv_asociar_jurisdiccion('alc-juego-regulado', 'ES', 'Spanish logs.', 'Norma X', 'https://www.boe.es/z', '2026-01-01');
do $$
declare r jsonb; s text[];
begin
  -- lo que construyes + una transversal: lo del juego y lo genérico; NO la seguridad de la clínica
  r := public.db_public_requirements_srv_buscar(null, null, array['alc-juego','alc-seguridad'], 5, null, 50);
  select array_agg(x->>'slug' order by x->>'slug') into s from jsonb_array_elements(r->'items') x;
  if s <> array['alc-generico','alc-juego-regulado','alc-juego-sync'] then raise exception 'alcance (juego+seguridad) mal: %', s; end if;
  if (r->>'total')::int <> 3 then raise exception 'total mal: %', r->>'total'; end if;
  -- la clínica + seguridad: lo de la clínica y lo genérico, nada del juego
  r := public.db_public_requirements_srv_buscar(null, null, array['alc-clinica','alc-seguridad'], 5, null, 50);
  select array_agg(x->>'slug' order by x->>'slug') into s from jsonb_array_elements(r->'items') x;
  if s <> array['alc-clinica-cifrado','alc-generico'] then raise exception 'alcance (clínica+seguridad) mal: %', s; end if;
  -- solo la transversal: la unión de siempre, pero lo regulatorio solo con país
  r := public.db_public_requirements_srv_buscar(null, null, array['alc-seguridad'], 5, null, 50);
  select array_agg(x->>'slug' order by x->>'slug') into s from jsonb_array_elements(r->'items') x;
  if s <> array['alc-clinica-cifrado','alc-generico'] then raise exception 'solo transversal sin país mal: %', s; end if;
  r := public.db_public_requirements_srv_buscar(null, null, array['alc-seguridad'], 5, null, 50, null, array['ES','EU'], false);
  select array_agg(x->>'slug' order by x->>'slug') into s from jsonb_array_elements(r->'items') x;
  if s <> array['alc-clinica-cifrado','alc-generico','alc-juego-regulado'] then raise exception 'solo transversal con país mal: %', s; end if;

  -- paginación: 2 por página, el total no cambia y las páginas no se pisan
  r := public.db_public_requirements_srv_buscar(null, null, array['alc-juego','alc-seguridad'], 5, null, 2);
  if (r->>'total')::int <> 3 or jsonb_array_length(r->'items') <> 2 then raise exception 'página 1 mal: %', r; end if;
  s := array[r->'items'->0->>'slug', r->'items'->1->>'slug'];
  r := public.db_public_requirements_srv_buscar(null, null, array['alc-juego','alc-seguridad'], 5, null, 2, null, null, false, 2);
  if (r->>'total')::int <> 3 or jsonb_array_length(r->'items') <> 1 then raise exception 'página 2 mal: %', r; end if;
  if (r->'items'->0->>'slug') = any (s) then raise exception 'la página 2 repite un elemento de la 1'; end if;
  r := public.db_public_requirements_srv_buscar(null, null, array['alc-juego','alc-seguridad'], 5, null, 2, null, null, false, 50);
  if jsonb_array_length(r->'items') <> 0 or (r->>'total')::int <> 3 then raise exception 'más allá del final: lista vacía y total igual'; end if;
end $$;
reset role;


-- ═══ 0013: sin «qué construyes» ni país, nada regulatorio (tampoco buscando solo por texto) ═══
set role service_role;
do $$
declare r jsonb; s text[];
begin
  -- sin ninguna categoría: lo regulatorio (con jurisdicción) no sale
  r := public.db_public_requirements_srv_buscar(null, null, null, 5, null, 200);
  select array_agg(x->>'slug') into s from jsonb_array_elements(r->'items') x;
  if s && array['alc-juego-regulado','pais-es-ue','pais-solo-es'] then raise exception 'sin categorías ni país salió algo regulatorio: %', s; end if;
  if not s @> array['alc-generico','pais-generico'] then raise exception 'sin categorías deben salir los genéricos: %', s; end if;
  -- solo texto: igual
  r := public.db_public_requirements_srv_buscar(null, 'logs', null, 5, null, 200);
  select coalesce(array_agg(x->>'slug'), '{}') into s from jsonb_array_elements(r->'items') x;
  if 'alc-juego-regulado' = any (s) then raise exception 'solo texto sin país sacó lo regulatorio'; end if;
  -- con país, sí
  r := public.db_public_requirements_srv_buscar(null, 'logs', null, 5, null, 200, null, array['ES','EU'], false);
  select coalesce(array_agg(x->>'slug'), '{}') into s from jsonb_array_elements(r->'items') x;
  if not 'alc-juego-regulado' = any (s) then raise exception 'con país debe salir lo regulatorio: %', s; end if;
  -- pidiendo su «qué construyes», también (como antes)
  r := public.db_public_requirements_srv_buscar(null, null, array['alc-juego'], 5, null, 200);
  select coalesce(array_agg(x->>'slug'), '{}') into s from jsonb_array_elements(r->'items') x;
  if not 'alc-juego-regulado' = any (s) then raise exception 'pidiendo el tipo de app debe salir: %', s; end if;
end $$;
reset role;
