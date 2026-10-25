// A steady tick for the admin page. Browsers slow down timers in a background tab (Chrome to once a minute after five minutes hidden), and the host
// tab is often behind the projector window, so the tick comes from a tiny worker, whose timers keep running. A slower setInterval runs beside it the
// whole time as a backstop (a worker can die without an error event; the host's tick is step-keyed, so an extra call does nothing). If the worker
// cannot be made or reports an error, the setInterval runs at full speed instead. Either way the game cannot stop advancing silently.
export function every(ms, fn, { backupMs = Math.max(1000, ms * 2) } = {}) {
  let w = null, fast = null;
  const backup = setInterval(fn, backupMs);
  const fallback = why => {
    if (fast) return;
    console.warn('admin tick: worker ' + why + ', using setInterval');
    if (w) { try { w.terminate(); } catch (e) { /* already gone */ } w = null; }
    fast = setInterval(fn, ms);
  };
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), ' + Number(ms) + ');'], { type: 'text/javascript' }));
    w = new Worker(url);
    w.onmessage = () => { if (!fast) fn(); };
    w.onerror = () => fallback('failed');
  } catch (e) {
    fallback('could not start');
  }
  return () => { clearInterval(backup); if (fast) clearInterval(fast); if (w) w.terminate(); };
}
