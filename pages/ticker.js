// A steady tick for the admin page. Browsers slow down timers in a background tab (Chrome to once a minute after five minutes hidden), and the host
// tab is often behind the projector window, so the tick comes from a tiny worker, whose timers keep running. If the worker cannot be made, fails
// later (onerror), or never sends a tick within the watchdog time, the tick falls back to setInterval, so the game can never stop advancing silently.
export function every(ms, fn, { watchdogMs = Math.max(2000, ms * 4) } = {}) {
  let w = null, iv = null, heard = false, dog = null;
  const fallback = why => {
    if (iv) return;
    if (why) console.warn('admin tick: worker ' + why + ', using setInterval');
    if (w) { try { w.terminate(); } catch (e) { /* already gone */ } w = null; }
    clearTimeout(dog);
    iv = setInterval(fn, ms);
  };
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), ' + Number(ms) + ');'], { type: 'text/javascript' }));
    w = new Worker(url);
    w.onmessage = () => { heard = true; if (!iv) fn(); };
    w.onerror = () => fallback('failed');
    dog = setTimeout(() => { if (!heard) fallback('sent no tick'); }, watchdogMs);
  } catch (e) {
    fallback('could not start');
  }
  return () => { clearTimeout(dog); if (w) w.terminate(); if (iv) clearInterval(iv); };
}
