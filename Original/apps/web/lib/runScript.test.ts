import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

let spawnMock: any;
vi.mock('node:child_process', () => {
  spawnMock = vi.fn();
  return {
    spawn: spawnMock,
    default: { spawn: spawnMock },
  };
});

test('resolves with error info when spawn fails', async () => {
  const { runScript } = await import('./runScript');
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  spawnMock.mockReturnValue(child);

  const promise = runScript('badcmd', []);
  setTimeout(() => child.emit('error', new Error('spawn failed')), 0);

  await expect(promise).resolves.toEqual({
    code: 1,
    stdout: '',
    stderr: 'Error: spawn failed',
  });
});
