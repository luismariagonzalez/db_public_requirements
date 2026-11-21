# Prompt de revisión jurídico-técnica (juego online, España)

Prompt para pasar a un agente revisor junto con los ficheros de `semilla/regulacion-es/*.json` (contenido generado, no versionado). Sirve para auditar la semilla contra fuentes oficiales **antes** de cargarla en la base compartida (ver «Pendiente / sin verificar» en `AGENTS.md`). El revisor solo audita: no reescribe el contenido.

---

Actúa como revisor jurídico-técnico de regulación española de juego online. Te adjunto ficheros JSON con requisitos y tests que describen obligaciones de la normativa española del juego online. Te pido que los verifiques contra FUENTES OFICIALES y me devuelvas un informe. No reescribas el contenido: solo audita.

CONTEXTO
- Los requisitos están en inglés y dicen QUÉ debe cumplir un operador, nunca dónde se muestra (ni pantallas ni botones).
- Cada elemento trae: title, statement, criteria, kind (functional|technical), prioridad por categoría (P1 = obligación legal sin la cual no se puede operar o hay sanción; P2 = obligación expresa de menor gravedad; P3-P5 = buenas prácticas o recomendaciones), y, para España, una nota con norma, artículo/apartado, URL y fecha de versión.
- Los tests son escenarios dado/cuando/entonces ligados a un requisito.

NORMAS QUE DEBERÍAN CUBRIRSE (compruébalo; añade las que falten)
Ley 13/2011 de regulación del juego; RD 1614/2011 y RD 1613/2011; RD 176/2023 (entornos más seguros de juego); RD 958/2020 (comunicaciones comerciales; ojo a los apartados anulados por el Tribunal Supremo en 2024); Ley 10/2010 y RD 304/2014 en lo aplicable al juego; resoluciones de la DGOJ (identidad 2012, especificaciones técnicas 2014, 2018, 2024); Órdenes EHA/3080, 3084, 3085, 3087, 3088 y 3089 de 2011; RGPD y LOPDGDD solo en lo que citan esas normas.

QUÉ HACER, para CADA requisito y CADA test
1. Abre la fuente oficial citada (BOE consolidado, sede de la DGOJ, EUR-Lex) y comprueba que el artículo o apartado existe, que está en vigor y que dice lo que afirma el requisito.
2. Marca uno de estos veredictos: CORRECTO / IMPRECISO (con la corrección propuesta) / INCORRECTO / NO VERIFICABLE (no encuentras fuente oficial) / DEROGADO O ANULADO.
3. Comprueba la prioridad: ¿es de verdad una obligación legal (P1/P2) o una recomendación (P3-P5)?
4. Comprueba que el requisito no mezcla dos obligaciones distintas y que no describe interfaz.
5. Comprueba que cada test valida realmente el requisito al que está ligado.

PUNTOS CONCRETOS QUE QUIERO QUE RESUELVAS
- RD 520/2026 (límites de depósito conjuntos y entrada en vigor en 2027): confirma que existe, su texto y su fecha de entrada en vigor.
- RD 813/2026: modifica el art. 21.2 del RD 304/2014 con un régimen transitorio: léelo y dime qué cambia y desde cuándo.
- Plazos de conservación de datos: el RD 1613/2011 parece decir 6 años y la Resolución de 2024 4 años. Dime cuál prevalece, para qué datos y desde cuándo.
- Verificación de identidad y plazos de verificación documental.
- Qué requisitos de RD 958/2020 siguen vigentes tras la anulación parcial del Supremo.
- Cualquier obligación importante que falte (por ejemplo: autoexclusión y RGIAJ, límites de depósito/tiempo/pérdida, mensajes de juego seguro, cuentas de juego, auditoría y homologación técnica, bonos) y que no esté cubierta.

REGLAS ESTRICTAS
- No te bases en tu memoria: cita para cada afirmación la URL oficial exacta y la fecha de la versión consultada.
- Si no puedes comprobar algo en una fuente oficial, di «no verificable»; no lo supongas ni lo rellenes.
- No inventes números de ley, artículos ni fechas.
- Distingue claramente entre obligación legal y recomendación o guía.
- Esto es información orientativa, no asesoramiento jurídico; indícalo al final.

FORMATO DE SALIDA
1. Resumen: número de elementos revisados y cuántos hay en cada veredicto.
2. Tabla con una fila por elemento: slug | veredicto | problema (si lo hay) | corrección propuesta | fuente oficial (URL + fecha).
3. Lista de obligaciones que faltan, con su fuente.
4. Respuestas a los puntos concretos de arriba.
5. Lista de elementos que recomiendas NO cargar hasta aclararlos.
