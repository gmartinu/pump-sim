import path from 'node:path';

/**
 * How `--ui` opens its window: an app window (no tabs, no address bar) in Edge, then Chrome, then
 * the default browser. Browsers are found by their install path, never through `start msedge`:
 * on a machine without Edge registered, `start` opens a Windows error dialog instead of failing.
 */
export interface Abertura {
  cmd: string;
  args: string[];
  /** `cmd.exe` parses its own line: pass it verbatim so `start ""` keeps the empty title. */
  verbatim?: boolean;
}

/** Install paths, in order of preference, for one platform. */
export function caminhosNavegadores(plataforma: NodeJS.Platform, env: NodeJS.ProcessEnv): { edge: string[]; chrome: string[] } {
  if (plataforma === 'win32') {
    const raizes = [env['ProgramFiles(x86)'], env['ProgramFiles'], env['LOCALAPPDATA']].filter((r): r is string => Boolean(r));
    const em = (rel: string) => raizes.map((r) => path.win32.join(r, rel));
    return {
      edge: em('Microsoft\\Edge\\Application\\msedge.exe'),
      chrome: em('Google\\Chrome\\Application\\chrome.exe'),
    };
  }
  if (plataforma === 'darwin') {
    return {
      edge: ['/Applications/Microsoft Edge.app'],
      chrome: ['/Applications/Google Chrome.app'],
    };
  }
  return {
    edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
    chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  };
}

/** The command that opens `url`: Edge `--app`, else Chrome `--app`, else the default browser. */
export function comoAbrir(url: string, plataforma: NodeJS.Platform, env: NodeJS.ProcessEnv, existe: (p: string) => boolean): Abertura {
  const { edge, chrome } = caminhosNavegadores(plataforma, env);
  const achado = [...edge, ...chrome].find(existe);
  const app = `--app=${url}`;
  if (plataforma === 'darwin') {
    if (achado) return { cmd: 'open', args: ['-na', path.basename(achado, '.app'), '--args', app] };
    return { cmd: 'open', args: [url] };
  }
  if (achado) return { cmd: achado, args: [app] };
  if (plataforma === 'win32') return { cmd: 'cmd', args: ['/c', `start "" "${url}"`], verbatim: true };
  return { cmd: 'xdg-open', args: [url] };
}
