import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKEND_PORT } from '@lbab/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  port: Number(process.env.PORT ?? BACKEND_PORT),
  dataDir: path.resolve(__dirname, '..', 'data'),
  dbFile: path.resolve(__dirname, '..', 'data', 'bridge.sqlite'),
  testPagesDir: path.resolve(__dirname, 'test-pages'),
};
