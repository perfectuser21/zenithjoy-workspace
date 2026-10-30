// Fixed TLS tunnel for HK staging. Connects only to the official Aidge endpoint.
const net = require('node:net');

const LISTEN_HOST = '100.79.41.61';
const LISTEN_PORT = 18443;
const DESTINATION = 'aidge.cn-beijing.aliyuncs.com';
const CLIENTS = new Set(['100.86.118.99', '100.79.41.61', '127.0.0.1']);

net.createServer((client) => {
  const address = client.remoteAddress?.replace(/^::ffff:/, '');
  if (!CLIENTS.has(address)) {
    client.destroy();
    return;
  }
  const upstream = net.connect({ host: DESTINATION, port: 443 });
  const closeBoth = () => {
    client.destroy();
    upstream.destroy();
  };
  client.setTimeout(45_000, closeBoth);
  upstream.setTimeout(45_000, closeBoth);
  client.on('error', closeBoth);
  upstream.on('error', closeBoth);
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  client.pipe(upstream);
  upstream.pipe(client);
}).listen(LISTEN_PORT, LISTEN_HOST);
