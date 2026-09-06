/** Imported before project entry modules, after the native React runtime setup. */
export const nativePreviewConsoleSource = `
const NativeModules = require('react-native').NativeModules;
const send = globalThis.__runwhalePreviewLog || NativeModules.RunWhalePreviewConsole?.log;
if (send && !globalThis.__runwhalePreviewConsoleInstalled) {
  globalThis.__runwhalePreviewConsoleInstalled = true;
  const bounded = value => {
    try { return (typeof value === 'string' ? value : value instanceof Error ? value.stack || value.message : JSON.stringify(value) ?? String(value)).slice(0, 1024); }
    catch { return '[unserializable]'; }
  };
  for (const level of ['debug','log','info','warn','error']) {
    const original = console[level];
    console[level] = function(...values) {
      try { send(level === 'log' ? 'info' : level, values.map(bounded).join(' ').slice(0,1024)); } catch {}
      return original.apply(console, values);
    };
  }
}
`
