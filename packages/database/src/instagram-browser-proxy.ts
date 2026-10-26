import { createServer } from "node:http";
import { connect, BlockList, isIP, type Socket } from "node:net";
import { lookup } from "node:dns/promises";
import type { Duplex } from "node:stream";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix);
export function publicBrowserAddress(address: string) {
  // Proxy deliberately uses IPv4 only; avoids mapped/private IPv6 ambiguity.
  return isIP(address) === 4 && !blocked.check(address);
}
export function allowedBrowserUrl(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      ["instagram.com", "cdninstagram.com", "fbcdn.net"].some(
        (h) => u.hostname === h || u.hostname.endsWith(`.${h}`),
      )
    );
  } catch {
    return false;
  }
}
/** HTTPS CONNECT proxy: validate every destination, pin the public DNS answer,
 * and bound encrypted transfer. Chromium still verifies the origin certificate. */
export async function startInstagramProxy() {
  const sockets = new Set<Duplex>();
  let bytes = 0,
    connections = 0,
    closed = false;
  const server = createServer((_req, res) => {
    res.writeHead(403);
    res.end();
  });
  const stop = () => {
    closed = true;
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  const timer = setTimeout(stop, 45000);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  server.on("connect", async (req, client, head) => {
    let upstream: Socket | undefined;
    try {
      const destination = req.url ?? "";
      if (
        closed ||
        ++connections > 100 ||
        !/^[a-z0-9.-]+:443$/i.test(destination) ||
        !allowedBrowserUrl(`https://${destination}/`)
      )
        throw new Error("Blocked destination");
      const hostname = destination.slice(0, -4);
      const addresses = await lookup(hostname, { all: true, family: 4 });
      if (
        closed ||
        client.destroyed ||
        !addresses.length ||
        addresses.some((a) => !publicBrowserAddress(a.address))
      )
        throw new Error("Blocked address");
      upstream = connect({ host: addresses[0].address, port: 443 });
      sockets.add(upstream);
      const remote = upstream;
      remote.setTimeout(15000, () => remote.destroy());
      remote.on("error", () => client.destroy());
      remote.on("close", () => {
        sockets.delete(remote);
        client.destroy();
      });
      client.on("close", () => remote.destroy());
      const count = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 40_000_000) stop();
      };
      remote.on("data", count);
      client.on("data", count);
      remote.once("connect", () => {
        if (closed || client.destroyed) return remote.destroy();
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) {
          count(head);
          remote.write(head);
        }
        client.pipe(remote);
        remote.pipe(client);
      });
    } catch {
      upstream?.destroy();
      client.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Proxy unavailable");
  return {
    server: `http://127.0.0.1:${address.port}`,
    close: () => {
      clearTimeout(timer);
      stop();
    },
  };
}
