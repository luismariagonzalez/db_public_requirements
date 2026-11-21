import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esIpPrivada, validarUrlAcelerador, comprobarUrlSegura, MAX_REDIRECCIONES } from '../lib/url_segura.mjs';

test('esIpPrivada: IPv4 e IPv6', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '172.31.255.1', '192.168.0.9', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.1.1.1', 'no-es-ip'])
    assert.equal(esIpPrivada(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111'])
    assert.equal(esIpPrivada(ip), false, ip);
});

test('validarUrlAcelerador: solo https público', () => {
  assert.equal(validarUrlAcelerador('https://lucia-auth.com/docs#x').url, 'https://lucia-auth.com/docs');
  for (const u of ['http://lucia-auth.com', 'ftp://x.com', 'javascript:alert(1)', 'https://localhost', 'https://foo.localhost', 'https://x.local', 'https://srv.internal/',
    'https://127.0.0.1', 'https://[::1]/', 'https://2130706433/', 'https://0x7f.0.0.1/', 'https://a:b@x.com', 'https://x.com:8080', 'https://intranet', '', 'https://' + 'a'.repeat(300) + '.com'])
    assert.equal(validarUrlAcelerador(u).ok, false, u);
});

test('comprobarUrlSegura: estados como la semilla (401/403/429 cuentan como existe)', async () => {
  const con = (status) => ({ peticion: async () => ({ status }) });
  assert.equal((await comprobarUrlSegura('https://a.dev', con(200))).ok, true);
  for (const s of [401, 403, 429]) assert.equal((await comprobarUrlSegura('https://a.dev', con(s))).ok, true);
  assert.equal((await comprobarUrlSegura('https://a.dev', con(404))).ok, false);
  assert.equal((await comprobarUrlSegura('https://a.dev', con(500))).ok, false);
});

test('comprobarUrlSegura: una redirección a una dirección privada se corta', async () => {
  const visitadas = [];
  const peticion = async (u) => { visitadas.push(u); return { status: 302, location: 'https://169.254.169.254/latest/meta-data/' }; };
  const r = await comprobarUrlSegura('https://a.dev', { peticion });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /redirects/);
  assert.deepEqual(visitadas, ['https://a.dev/']);   // no llegó a pedir la IP privada
});

test('comprobarUrlSegura: redirección a http o a localhost se corta; a https público se sigue', async () => {
  for (const loc of ['http://a.dev/x', 'https://localhost/x']) {
    const r = await comprobarUrlSegura('https://a.dev', { peticion: async () => ({ status: 301, location: loc }) });
    assert.equal(r.ok, false, loc);
  }
  let n = 0;
  const r = await comprobarUrlSegura('https://a.dev', { peticion: async () => (n++ === 0 ? { status: 301, location: '/docs' } : { status: 200 }) });
  assert.equal(r.ok, true);
  assert.equal(r.final, 'https://a.dev/docs');
});

test('comprobarUrlSegura: bucle de redirecciones y fallo de red', async () => {
  let n = 0;
  const r = await comprobarUrlSegura('https://a.dev', { peticion: async () => { n++; return { status: 302, location: 'https://a.dev/otra' + n }; } });
  assert.equal(r.ok, false);
  assert.equal(n, MAX_REDIRECCIONES + 1);
  const red = await comprobarUrlSegura('https://a.dev', { peticion: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(red.ok, false);
  assert.equal(red.red, true);
});

test('comprobarUrlSegura: una URL no válida no llega a la red', async () => {
  let llamadas = 0;
  const r = await comprobarUrlSegura('http://10.0.0.1/', { peticion: async () => { llamadas++; return { status: 200 }; } });
  assert.equal(r.ok, false);
  assert.equal(llamadas, 0);
});
