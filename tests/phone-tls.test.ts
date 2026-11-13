// The phones' address (Fouad, 2026-11-13): a start page on plain http, the authority to download, and https on its own
// port with a certificate that the authority alone makes trusted. The computers' address is left as it was.
import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { X509Certificate } from 'node:crypto';
import { startServer, type Running } from '../server/server';
import { isLocalIp } from '../server/phone-tls';

let srv: Running | null = null;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magis-phone-tls-'));
afterAll(async () => { await srv?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const get = (url: string, opts: https.RequestOptions = {}) =>
  new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, opts, (r) => { const parts: Buffer[] = []; r.on('data', (c) => parts.push(c)); r.on('end', () => resolve({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(parts) })); }).on('error', reject);
  });

describe('the phones address', () => {
  it('local addresses only', () => {
    expect(['192.168.1.55', '10.0.0.7', '172.20.1.1', '127.0.0.1'].every(isLocalIp)).toBe(true);
    expect(['8.8.8.8', '172.32.0.1', '192.169.0.1', 'x'].some(isLocalIp)).toBe(false);
  });

  it('start page, the authority, and https trusted through it', async () => {
    fs.mkdirSync(path.join(dir, 'web'));
    fs.writeFileSync(path.join(dir, 'web', 'index.html'), '<html>ok</html>');
    fs.writeFileSync(path.join(dir, 'web', 'phone.html'), '<html>phone</html>');
    srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'redirect', httpPort: 0, httpsPort: 0, phonePort: 0 }, log: () => undefined });
    expect(srv.phonePort).toBeGreaterThan(0);
    const plain = `http://127.0.0.1:${srv.httpPort}`;

    // plain http: the start page and the authority; everything else goes to https
    const page = await get(`${plain}/phone?l=en`);
    expect(page.status).toBe(200);
    expect(page.body.toString()).toContain('/magis-phones.cer');
    expect(page.body.toString()).toContain(`:${srv.phonePort}/phone.html`);
    expect((await get(`${plain}/`)).status).toBe(307);
    const cer = await get(`${plain}/magis-phones.cer`);
    expect(cer.status).toBe(200);
    expect(cer.headers['content-type']).toBe('application/x-x509-ca-cert');
    const ca = new X509Certificate(cer.body);
    expect(ca.ca).toBe(true);

    // the phones' address: trusted with the authority alone (Node checks the address and the name constraints)
    const ok = await get(`https://127.0.0.1:${srv.phonePort}/phone.html`, { ca: ca.toString() });
    expect(ok.status).toBe(200);
    expect(ok.body.toString()).toContain('phone');
    const where = JSON.parse((await get(`https://127.0.0.1:${srv.phonePort}/api/phone/where`, { ca: ca.toString() })).body.toString());
    expect(where.fingerprint).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){15}$/);

    // the computers' address keeps its own certificate, and sends the phone page to the phones' address
    const main = await get(`https://127.0.0.1:${srv.httpsPort}/phone.html`, { rejectUnauthorized: false });
    expect(main.status).toBe(307);
    expect(main.headers.location).toBe(`https://127.0.0.1:${srv.phonePort}/phone.html`);
    await expect(get(`https://127.0.0.1:${srv.httpsPort}/`, { ca: ca.toString() })).rejects.toThrow();

    // made once: a second start keeps the same authority
    const before = fs.readFileSync(path.join(dir, 'tls', 'phones-ca.pem'), 'utf8');
    await srv.close();
    srv = await startServer({ dataDir: dir, webRoot: path.join(dir, 'web'), config: { httpMode: 'redirect', httpPort: 0, httpsPort: 0, phonePort: 0 }, log: () => undefined });
    expect(fs.readFileSync(path.join(dir, 'tls', 'phones-ca.pem'), 'utf8')).toBe(before);
  }, 30_000);
});
