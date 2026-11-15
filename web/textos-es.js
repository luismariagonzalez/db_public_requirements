// Textos de la interfaz (español). El inglés está en textos-en.js y es el de reserva si falta una clave.
// Las variables van entre {llaves}. Las claves .html pueden llevar marcado: SOLO marcado de confianza.
// El contenido de la base de datos (requisitos, tests…) está en inglés y NO se traduce aquí.
export default {
  'meta.title': 'Requirements DB · lo que tu app debe cumplir, listo para tu agente de código',
  'meta.description': 'Una base de datos pública y colaborativa de requisitos, tests y aceleradores de software por tipo de app y asunto, con prioridades de 1 a 5. Busca, elige y pégaselos a tu agente de IA.',

  'nav.browse': 'Explorar', 'nav.api': 'API', 'nav.cli': 'CLI', 'nav.account': 'Cuenta', 'nav.terms': 'Términos', 'nav.main': 'Principal',
  'cuenta.entrar': 'Entrar', 'cuenta.salir': 'Salir', 'atajo.buscar': 'buscar',

  'hero.kicker': '// requisitos para tu agente de código',
  'hero.h1': 'Que tu agente no se olvide de lo básico y aburrido.',
  'hero.p.html': 'Elige los requisitos de tu tipo de app, con los tests que los comprueban y las librerías que los aceleran. Dicen <em>qué</em> debe hacer la app, nunca <em>dónde</em> va.',
  'hero.paso1': 'Elige categoría y prioridad', 'hero.paso2': 'Desmarca lo que no aplique', 'hero.paso3': 'Copia Markdown, curl o JSON',

  'lat.filtros': 'Filtros', 'busca.placeholder': 'Buscar por significado…', 'busca.aria': 'Buscar requisitos por significado',
  'lat.categoria': 'Categoría', 'filtro.placeholder': 'Filtrar: CRM, nóminas, LMS…', 'filtro.aria': 'Filtrar categorías de software',
  'lat.prioridad': 'Prioridad hasta', 'prio.aria': 'Prioridad máxima', 'lat.incluir': 'Incluir',
  'inc.tests': 'Tests', 'inc.acel': 'Aceleradores', 'lat.proyecto': 'Proyecto', 'proy.ninguno': '— ninguno —', 'proy.ocultar': 'Ocultar lo que ya hice',

  'lista.titulo': 'Requisitos', 'sel.todos': 'todos', 'sel.ninguno': 'ninguno', 'sel.cuenta': '{n}/{total} seleccionados',
  'marcar.texto': 'Marcar lo seleccionado en el proyecto como', 'marcar.aplicar': 'Aplicar', 'marcar.aria': 'Estado',
  'marcar.ok': '{n} elemento(s) marcados como {estado}',

  'g.audience': 'Audiencia', 'g.domain': 'Dominio', 'g.software_category': 'Categoría de software', 'g.app_type': 'Tipo de app',
  'g.screen_type': 'Tipo de pantalla', 'g.cross_cutting': 'Asuntos transversales',
  'g.mas': '{n} más: acótalo con el filtro de arriba.',

  'p1.n': 'esencial', 'p1.d': 'sin esto la app está rota o es insegura',
  'p2.n': 'esperado', 'p2.d': 'los usuarios dan por hecho que está',
  'p3.n': 'recomendado', 'p3.d': 'las apps sólidas lo hacen',
  'p4.n': 'deseable', 'p4.d': 'pulido',
  'p5.n': 'diferenciador', 'p5.d': 'te distingue de los demás',
  'prio.todo': 'Todo, de lo esencial a lo que diferencia.', 'prio.hasta': 'De P1 a P{n}, hasta «{nombre}» — {desc}.',

  'estado.elige': 'Elige una audiencia, una categoría o un tipo de app, o busca por significado.',
  'estado.buscando': 'Buscando…',
  'estado.vacio': 'Todavía no hay requisitos para esta selección. Prueba con los asuntos transversales (seguridad, privacidad…), con menos filtros, o aporta uno.',
  'err.429': 'Demasiadas peticiones. Inténtalo de nuevo en {s} segundos, o entra para tener un límite mayor.', 'err.429.poco': 'unos pocos',

  'item.incluir': 'Incluir {titulo}', 'det.tests': 'Tests', 'det.acel': 'Aceleradores', 'det.sugerir': 'Sugerir',
  'n.test.one': '{n} test', 'n.test.other': '{n} tests', 'n.acel.one': '{n} acelerador', 'n.acel.other': '{n} aceleradores',
  'n.req.one': '{n} requisito', 'n.req.other': '{n} requisitos',

  'est.planned': 'planeado', 'est.in_progress': 'en curso', 'est.done': 'hecho', 'est.skipped': 'descartado',
  'estl.planned': 'Planeado (roadmap)', 'estl.in_progress': 'En curso', 'estl.done': 'Hecho', 'estl.skipped': 'Descartado',

  'tabs.aria': 'Lo que recibe tu agente', 'copiar': 'Copiar', 'copiado': 'Copiado', 'copiar.fallo': 'No se pudo copiar: selecciona el texto a mano',
  'codigo.vacio': '// selecciona requisitos para ver lo que recibirá tu agente', 'codigo.mas': '{n} líneas más: «Copiar» las incluye todas',
  'codigo.preview': 'Vista previa', 'pie.chars': '{n} caracteres', 'pie.get': 'GET · público', 'pie.tests': ' · {n} tests',

  'api.kicker': '// api', 'api.h2': 'Úsalo desde tu agente',
  'api.p.html': 'Pública y con límite de uso: 20 peticiones por minuto sin clave. JSON por defecto, o Markdown listo para pegar con <code>format=md</code>, que termina con instrucciones para que tu agente anote en tu proyecto lo hecho y lo pendiente.',
  'api.leyenda': 'Escala de prioridad · por categoría',
  'api.lectura': 'Lectura · pública', 'api.clave': 'Con clave',
  'api.ep.cats': 'audiencias, dominios, categorías', 'api.ep.reqs.html': 'busca, filtra, <code>format=md</code>',
  'api.ep.tests': 'tests por categoría y prioridad', 'api.ep.acel': 'librerías y servicios',
  'api.ep.proyectos': 'tus proyectos', 'api.ep.marcar': 'marcar hecho / planeado / descartado', 'api.ep.sugerir': 'sugerir algo',
  'api.nota.html': 'Añade <code>project=&lt;id&gt;</code> a una búsqueda para ver lo que ya has hecho, y <code>hide=done</code> para saltártelo.',
  'api.cli.titulo': '¿Prefieres la terminal?', 'api.cli.p': 'El CLI reqdb es un solo fichero sin dependencias: baja los requisitos a tu repo, deja que tu agente marque el avance y haz que falle el CI mientras haya trabajo P1 pendiente.',
  'api.cli.enlace': 'Documentación del CLI para agentes →',

  'proy.h2': 'Mis proyectos',
  'proy.p.html': 'Apunta qué requisitos, tests y aceleradores has implementado en cada app, para que la próxima vez solo elijas lo nuevo. Tu agente también puede actualizarlo (mira la <a href="#api">API</a> y el <a href="./cli.html">CLI</a>).',
  'proy.nombre.placeholder': 'Nombre del proyecto nuevo, p. ej. «Acme chat»', 'proy.nombre.aria': 'Nombre del proyecto', 'proy.crear': 'Crear proyecto',
  'proy.vacio': 'Aún no tienes proyectos. Crea uno para empezar a llevar la cuenta.', 'proy.cuentas': '{done} hechos · {in_progress} en curso · {planned} planeados · {skipped} descartados',
  'proy.abrir': 'Abrir', 'proy.cerrar': 'Cerrar', 'proy.borrar': 'Borrar', 'proy.nada': 'Todavía no hay nada apuntado.', 'proy.estado.de': 'Estado de {titulo}',
  'proy.confirmar': '¿Borrar el proyecto «{nombre}» y todo lo que lleva apuntado?', 'proy.dale.nombre': 'Ponle un nombre al proyecto.', 'proy.creado': 'Proyecto creado y seleccionado',

  'aporte.h2': 'Aporta un requisito',
  'aporte.p': 'Describe algo que debería hacer una app, en cualquier idioma. Una IA lo revisa: comprueba que es un requisito de verdad, si ya existe (y entonces lo fusiona o lo rechaza) y quita todo lo que hable de pantallas o diseño.',
  'aporte.placeholder': 'p. ej. Los usuarios deben poder bloquear a otro usuario para dejar de recibir sus mensajes.',
  'aporte.terminos.html': 'Tengo derecho a enviar esto y acepto los <a href="./terms.html">Términos del contenido</a>, incluida la licencia que concedo al proyecto sobre mi aportación.',
  'aporte.enviar': 'Enviar a revisión', 'aporte.mias': 'Mis aportaciones', 'aporte.revisando': 'Revisando…',
  'aporte.corto': 'Escribe al menos una frase (10 caracteres).', 'aporte.acepta': 'Acepta los Términos del contenido, por favor.',
  'aporte.duplicado': ' — ya existe como {slug}',
  'ap.created': 'Creado', 'ap.merged': 'Fusionado', 'ap.rejected': 'No añadido', 'ap.needs_human': 'Lo mirará una persona', 'ap.pending': 'Pendiente',

  'sug.h2': 'Sugiere algo',
  'sug.p': '¿Falta un test o un acelerador, un requisito se puede mejorar o hay algo mal? Una persona revisa cada sugerencia. Usa «Sugerir» en cualquier resultado para señalarlo.',
  'sug.tipo.aria': 'Tipo', 'sug.tipo.improvement': 'Mejorar algo', 'sug.tipo.new_item': 'Añadir algo nuevo', 'sug.tipo.report': 'Avisar de un problema',
  'sug.obj.aria': 'Tipo de elemento', 'sug.obj.requirement': 'requisito', 'sug.obj.test': 'test', 'sug.obj.accelerator': 'acelerador', 'sug.obj.general': 'general',
  'sug.slug.placeholder': 'Sobre qué (slug, opcional)', 'sug.slug.aria': 'Slug del que trata', 'sug.placeholder': '¿Qué debería cambiar y por qué?',
  'sug.enviar': 'Enviar sugerencia', 'sug.mias': 'Mis sugerencias', 'sug.entra': 'Entra para enviar sugerencias', 'sug.gracias': '¡Gracias! Una persona la revisará.',
  'sug.estado.new': 'nueva', 'sug.estado.accepted': 'aceptada', 'sug.estado.dismissed': 'descartada',

  'claves.h2': 'Claves de API',
  'claves.p': 'Las claves suben tu límite de uso y dejan que tu agente (o el CLI) lea, actualice tus proyectos y envíe sugerencias. Guárdalas en secreto: solo se muestran una vez.',
  'claves.nombre.placeholder': 'Nombre, p. ej. «mi Claude Code»', 'claves.nombre.aria': 'Nombre de la clave', 'claves.crear': 'Crear clave',
  'claves.vacio': 'Aún no tienes claves.', 'claves.revocada': 'revocada', 'claves.usada': 'usada el {fecha}', 'claves.nunca': 'sin usar', 'claves.revocar': 'Revocar',
  'claves.dale.nombre': 'Ponle un nombre a la clave.', 'claves.nueva': 'Cópiala ahora: no se volverá a mostrar.',
  'datos.borrar': 'Borrar mis datos', 'datos.confirmar': 'Esto borra tus claves de API, aportaciones, proyectos y sugerencias, y anonimiza el contenido del que eres autor. ¿Continuar?',
  'datos.borrados': 'Tus datos se han borrado.', 'nada.todavia': 'Todavía nada.',

  'pie.texto': 'reqdb · curado por la comunidad · código MIT', 'pie.legal': 'Aviso legal y privacidad', 'pie.terminos': 'Términos del contenido', 'pie.cli': 'CLI',
  'idioma.aria': 'Idioma',
};
