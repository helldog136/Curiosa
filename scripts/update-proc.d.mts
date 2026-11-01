// Types de ce que le site (src/core/updates/hosting.ts) utilise de scripts/update-proc.mjs.
export type ProcInfo = { pid: number; ppid: number; state?: string; cwd: string | null; args: string[]; cgroup: string | null };
export type HostingWarning = { code: "npx" | "second-manager"; manager?: string; unit?: string | null; pid?: number; command?: string; port?: number };
export function readProcTable(procDir?: string): ProcInfo[];
export function listeningPortsOf(pid: number, procDir?: string): number[];
export function resolveSitePort(o?: { env?: Record<string, string | undefined>; sys?: unknown; serverPid?: number }): number;
export function detectHosting(o: { appDir: string; port: number; procs: ProcInfo[]; selfPid?: number; serverPid?: number }): HostingWarning[];
export function systemProc(o?: { procDir?: string }): { procs(): ProcInfo[]; listeningPortsOf(pid: number): number[] };
