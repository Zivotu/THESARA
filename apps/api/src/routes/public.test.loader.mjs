import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
register(new URL('./public.test.loader-impl.mjs', import.meta.url).href);
