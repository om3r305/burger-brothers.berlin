// Debug WebView inspection only. Start an adb forward before using this helper.
export async function connect(port = 9223) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(t => t.type === 'page');
  if (!target) throw new Error('No debug WebView page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timeout);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timeout = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timeout`)); }, 15000);
    pending.set(key, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id:key, method, params }));
  });
  return {
    send,
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    close:() => socket.close(),
  };
}
if (process.argv[2]) {
  const client = await connect(Number(process.env.CDP_PORT || 9223));
  try { console.log(JSON.stringify(await client.evaluate(process.argv[2]), null, 2)); }
  finally { client.close(); }
}
