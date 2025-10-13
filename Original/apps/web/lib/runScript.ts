import { spawn } from "node:child_process";

export async function runScript(cmd: string, args: string[], opts?: { cwd?: string }) {
  return new Promise<{ code:number; stdout:string; stderr:string }>((resolve) => {
    const child = spawn(cmd, args, { stdio: "pipe", shell: false, cwd: opts?.cwd });
    let out = ""; let err = "";
    child.stdout.on("data", (b) => (out += b.toString()));
    child.stderr.on("data", (b) => (err += b.toString()));
    child.on("error", (err) =>
      resolve({ code: 1, stdout: "", stderr: String(err) })
    ); // consider rejecting for clearer upstream handling
    child.on("close", (code) => resolve({ code: code ?? 0, stdout: out, stderr: err }));
  });
}
