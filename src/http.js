import http from 'node:http';
import { notFoundPage } from './views.js';

export function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

export function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}

/** Block form posts that come from another website (the browser sends an Origin header). */
export function isSameSite(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export async function readForm(req, limit = 20_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Body too large');
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

/** Wrap a request handler in a server that turns crashes into a friendly error page. */
export function createHttpServer(handle) {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, notFoundPage('Something went wrong. Please try again.'));
    });
  });
}