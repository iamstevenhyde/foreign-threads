// A steady tick for the admin page. Browsers slow down timers in a background tab (Chrome to once a minute after five minutes hidden), and the host
// tab is often behind the projector window, so the tick comes from a tiny worker, whose timers keep running. Falls back to setInterval.
export function every(ms, fn) {
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), ' + Number(ms) + ');'], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = () => fn();
    return () => w.terminate();
  } catch (e) {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }
}
