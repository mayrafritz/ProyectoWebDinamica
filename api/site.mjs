import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manejar = require('../servidor.js');

export default (req, res) => {
  const url = new URL(req.url, 'https://vercel.local');
  const pathname = url.searchParams.get('__pathname');

  if (pathname) {
    url.searchParams.delete('__pathname');
    req.url = pathname + url.search;
  }

  return manejar(req, res);
};
