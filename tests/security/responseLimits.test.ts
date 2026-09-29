import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import axios from 'axios';
import ts from 'typescript';
import {
  RESPONSE_LIMITS, ResponseTooLargeError, readBodyWithLimit, readJsonWithLimit,
} from '../../backend/utils/responseLimits';
import { listTsFiles } from './sqlGuard';

const ROOT = path.resolve(__dirname, '../..');
const MB = 1024 * 1024;

describe('RESPONSE_LIMITS', () => {
  it('leaves generous room over the sizes the sources really send', () => {
    // FIRMS VIIRS global 24 h CSV: up to ~30–40 MB on a peak day
    expect(RESPONSE_LIMITS.firmsCsv).toBeGreaterThanOrEqual(100 * MB);
    // Overpass OOPT with full geometry: tens of MB
    expect(RESPONSE_LIMITS.overpass).toBeGreaterThanOrEqual(200 * MB);
    // Overpass roads and settlements within 15 km of an incident: a few MB near a city
    expect(RESPONSE_LIMITS.overpassContext).toBeGreaterThanOrEqual(16 * MB);
    expect(RESPONSE_LIMITS.rosleshozCsv).toBeGreaterThanOrEqual(20 * MB);
    expect(RESPONSE_LIMITS.gfwTile).toBeGreaterThanOrEqual(5 * MB);
    for (const value of Object.values(RESPONSE_LIMITS)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(256 * MB);
    }
  });
});

describe('every outgoing axios request has a response size limit', () => {
  /** axios.get/post/request(...) calls in backend/ whose options object lacks maxContentLength. */
  function unlimitedAxiosCalls(): string[] {
    const missing: string[] = [];
    for (const full of listTsFiles(path.join(ROOT, 'backend'))) {
      const rel = path.relative(ROOT, full).split(path.sep).join('/');
      const sf = ts.createSourceFile(rel, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'axios') {
          const hasLimit = node.arguments.some(a => ts.isObjectLiteralExpression(a)
            && a.properties.some(p => p.name !== undefined && p.name.getText(sf) === 'maxContentLength'));
          if (!hasLimit) missing.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return missing;
  }

  it('passes maxContentLength on each call', () => {
    expect(unlimitedAxiosCalls()).toEqual([]);
  });
});

async function withServer(body: Buffer, fn: (url: string) => Promise<void>, headers: Record<string, string> = {}) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/csv', ...headers });
    res.end(body);
  }).listen(0);
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/data.csv`);
  } finally {
    server.close();
  }
}

describe('axios maxContentLength (how the services use it)', () => {
  it('aborts a text response over the limit', async () => {
    await withServer(Buffer.alloc(4096, 'a'), async url => {
      await expect(axios.get(url, { responseType: 'text', maxContentLength: 1024 }))
        .rejects.toThrow(/maxContentLength size of 1024 exceeded/);
      const ok = await axios.get(url, { responseType: 'text', maxContentLength: 8192 });
      expect(ok.data).toHaveLength(4096);
    });
  });

  it('aborts a binary response over the limit', async () => {
    await withServer(Buffer.alloc(4096, 1), async url => {
      await expect(axios.get(url, { responseType: 'arraybuffer', maxContentLength: 1024 }))
        .rejects.toThrow(/maxContentLength/);
    });
  });
});

describe('readBodyWithLimit (fetch)', () => {
  const streamOf = (chunks: number[]) => new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size).fill(97));
      controller.close();
    },
  });

  it('returns bodies within the limit', async () => {
    const buf = await readBodyWithLimit(new Response('hello'), 5);
    expect(buf.toString()).toBe('hello');
    expect(await readJsonWithLimit(new Response('{"a":1}'), 100)).toEqual({ a: 1 });
  });

  it('rejects a declared content-length over the limit without reading the body', async () => {
    const res = new Response(streamOf([10]), { headers: { 'content-length': '5000000' } });
    await expect(readBodyWithLimit(res, 1000)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('counts streamed bytes when content-length is missing or understated', async () => {
    await expect(readBodyWithLimit(new Response(streamOf([400, 400, 400])), 1000))
      .rejects.toThrow(/exceeds 1000 bytes/);
    const understated = new Response(streamOf([600, 600]), { headers: { 'content-length': '10' } });
    await expect(readBodyWithLimit(understated, 1000)).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect((await readBodyWithLimit(new Response(streamOf([400, 400])), 1000)).length).toBe(800);
  });

  it('works with a real fetch()', async () => {
    await withServer(Buffer.alloc(3000, 'b'), async url => {
      await expect(readBodyWithLimit(await fetch(url), 1000)).rejects.toBeInstanceOf(ResponseTooLargeError);
      expect((await readBodyWithLimit(await fetch(url), 3000)).length).toBe(3000);
    });
  });
});
