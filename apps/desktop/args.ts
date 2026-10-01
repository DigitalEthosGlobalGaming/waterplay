/** Command-line flags the dev orchestrator passes to each Electron instance (§13.4.2). */
export interface DesktopArgs {
  devServerUrl: string | null;
  instance: string;
  role: 'host' | 'client';
  slot: number;
  slots: number;
  sessionsDir: string | null;
  fresh: boolean;
}

export function parseDesktopArgs(argv: readonly string[]): DesktopArgs {
  const get = (name: string) => {
    const prefix = `--${name}=`;
    return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null;
  };
  return {
    devServerUrl: get('dev-server-url'),
    instance: get('dev-instance') ?? 'A',
    role: get('dev-role') === 'client' ? 'client' : 'host',
    slot: Number(get('dev-slot') ?? 0),
    slots: Math.max(1, Number(get('dev-slots') ?? 1)),
    sessionsDir: get('dev-sessions-dir'),
    fresh: argv.includes('--fresh'),
  };
}
