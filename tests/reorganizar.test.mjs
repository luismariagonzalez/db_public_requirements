import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claseFija, slugDe, flujosValidos, arquetiposValidos, transversalesQueFaltan, ARQUETIPOS, ARQUETIPOS_NUEVOS,
  ARQUETIPO_COMODIN, FLUJOS_ACCESO } from '../lib/reorganizar.mjs';

test('regla fija de la clase: lo funcional se queda, rendimiento y fiabilidad pasan a técnico, el resto lo decide la IA', () => {
  assert.equal(claseFija('functional'), 'functional');
  for (const k of ['technical', 'performance', 'reliability']) assert.equal(claseFija(k), 'technical');
  for (const k of ['security', 'privacy', 'accessibility', 'ux', 'legal']) assert.equal(claseFija(k), null);
});

test('slugDe replica el slugify de SQL', () => {
  assert.equal(slugDe('Password Reset via Single-Use Expiring Token'), 'password-reset-via-single-use-expiring-token');
  assert.equal(slugDe('  ¡Hola, mundo!  '), 'hola-mundo');
  assert.equal(slugDe('A'.repeat(200)).length, 110);
});

test('flujos y arquetipos de la IA se validan; sin respuesta útil hay valor de reserva', () => {
  assert.deepEqual(flujosValidos(['flow-sign-in', 'flow-sign-in', 'inventado']), ['flow-sign-in']);
  assert.equal(flujosValidos(['inventado']), null);
  assert.equal(flujosValidos(undefined), null);
  assert.deepEqual(arquetiposValidos(['crm-sales', 'b2b', 'helpdesk-support', 'erp-operations', 'hr-people']), ['crm-sales', 'helpdesk-support', 'erp-operations']);
  assert.deepEqual(arquetiposValidos([]), [ARQUETIPO_COMODIN]);
  assert.deepEqual(arquetiposValidos(['nada']), [ARQUETIPO_COMODIN]);
});

test('transversales que faltan: solo los de su tema y con la mejor prioridad que ya tenían', () => {
  const r = transversalesQueFaltan([
    { slug: 'a', kind: 'security', categories: [{ slug: 'messaging', priority: 3 }, { slug: 'privacy-gdpr', priority: 2 }] },
    { slug: 'b', kind: 'security', categories: [{ slug: 'security', priority: 1 }] },          // ya lo tiene
    { slug: 'c', kind: 'ux', categories: [{ slug: 'messaging', priority: 4 }] },               // ux no tiene transversal
    { slug: 'd', kind: 'reliability', categories: [{ slug: 'saas-b2b', priority: 5 }] },
  ]);
  assert.deepEqual(r, [{ slug: 'a', categoria: 'security', prioridad: 2 }, { slug: 'd', categoria: 'reliability-observability', prioridad: 5 }]);
});

test('los arquetipos nuevos y los flujos de acceso existen en la migración 0004', () => {
  const sql = readFileSync(new URL('../supabase/migraciones/0004_modelo_filtros.sql', import.meta.url), 'utf8');
  // marketing-automation-platform nació después (el slug «marketing-automation» ya era una categoría de Capterra): lo crea la semilla
  for (const [slug] of ARQUETIPOS_NUEVOS.filter(([s]) => s !== 'marketing-automation-platform')) assert.ok(sql.includes(`'${slug}'`), slug);
  for (const f of FLUJOS_ACCESO) assert.ok(sql.includes(`'${f}'`), f);
  assert.equal(new Set(ARQUETIPOS).size, ARQUETIPOS.length);
});
