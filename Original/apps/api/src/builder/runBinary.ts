import { spawn, type SpawnOptions } from 'node:child_process';

export async function runNodeCli(
  moduleCliJs: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<void> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [moduleCliJs, ...args], {
      stdio: 'inherit',
      ...options,
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`process exited with code ${code}`));
    });
  });
}
