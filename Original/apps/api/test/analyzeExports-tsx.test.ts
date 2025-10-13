import assert from 'node:assert/strict';
import { analyzeExports } from '../src/builder/build.ts';

(async () => {
  const code = `export default function App(): JSX.Element { return <div>Hello</div>; }`;
  const res = await analyzeExports(code);
  assert.deepEqual(res, { hasDefault: true, hasMount: false });
  console.log('analyzeExports tsx test passed');
})();
