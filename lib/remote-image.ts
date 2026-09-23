// Server-only by convention (see lib/domain-check.ts): Node built-ins. Only import from
// lib/storage.ts.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Downloads an image from an owner-supplied link so it can be copied into our own storage.
 *
 * This is a server-side fetch of an arbitrary URL, i.e. an SSRF surface: without guards an owner
 * could point it at the server itself, the cloud metadata endpoint or anything else on the
 * private network. So:
 * - http/https only, default ports only, no credentials in the URL;
 * - every address a hostname resolves to is checked against private/reserved ranges *inside the
 *   socket's own DNS lookup*, so what's checked is exactly what's connected to (no DNS-rebinding
 *   gap between a check and the connect); literal IPs, which skip that lookup, are checked first;
 * - redirects are followed by hand (max 3), each hop re-checked the same way;
 * - one overall timeout, and the body is capped while streaming (Content-Length isn't trusted).
 * The caller still decides the file type from its bytes, never from the response headers.
 */

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

/** A failure whose message is safe to show the owner. */
export class RemoteImageError extends Error {}

const blocked = new net.BlockList();
for (const [net4, prefix] of [
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
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net4, prefix, "ipv4");
}
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
for (const [net6, prefix] of [
  ["64:ff9b::", 96], // NAT64 — maps onto IPv4, including private ranges
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net6, prefix, "ipv6");
}

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return blocked.check(ip, "ipv4");
  if (net.isIPv6(ip)) {
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1): judge by the embedded IPv4 address.
    const mapped = ip.match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i);
    if (mapped) {
      const v4 = mapped[1] ?? [parseInt(mapped[2], 16), parseInt(mapped[3], 16)]
        .flatMap((n) => [n >> 8, n & 0xff])
        .join(".");
      return blocked.check(v4, "ipv4");
    }
    return blocked.check(ip, "ipv6");
  }
  return true;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * Drop-in for the socket's DNS lookup that refuses private addresses. Node 22 connects with
 * autoSelectFamily, which calls this with `{ all: true }` and expects an array back; plain
 * connects expect (address, family). Both shapes are handled.
 */
function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
      return callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }), "");
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

function checkUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteImageError("Only http(s) links can be imported.");
  }
  if (url.username || url.password || url.port) {
    throw new RemoteImageError("That link can't be imported.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new RemoteImageError("That link can't be imported.");
  }
}

function request(url: URL, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.get(url, {
      signal,
      lookup: safeLookup as unknown as net.LookupFunction,
      headers: {
        // Raw http doesn't decompress; ask for the plain bytes.
        "Accept-Encoding": "identity",
        // No AVIF: format-negotiating CDNs (imgix, Cloudinary, Shopify...) would send it, and only
        // PNG/JPG/WEBP/GIF are accepted.
        Accept: "image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; StoreImageImporter/1.0)",
      },
    });
    req.on("response", resolve);
    req.on("error", reject);
  });
}

async function readCapped(res: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      res.destroy();
      throw new RemoteImageError(`Image must be ${Math.round(maxBytes / 1024 / 1024)}MB or smaller.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Fetches the bytes behind an owner-supplied image link. Throws RemoteImageError (safe to show)
 * or another error (log it, show something generic). */
export async function fetchRemoteImage(link: string, maxBytes: number): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new RemoteImageError("That doesn't look like a link.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; ; hop++) {
      checkUrl(url);
      const res = await request(url, controller.signal);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= MAX_REDIRECTS) throw new RemoteImageError("That link redirects too many times.");
        url = new URL(res.headers.location, url);
        continue;
      }
      if (status !== 200) {
        res.resume();
        throw new RemoteImageError(`That link didn't return an image (HTTP ${status}).`);
      }
      return await readCapped(res, maxBytes);
    }
  } catch (err) {
    if (err instanceof RemoteImageError) throw err;
    if (controller.signal.aborted) throw new RemoteImageError("That link took too long to respond.");
    const code = (err as { code?: string }).code;
    if (code === "EBLOCKED") throw new RemoteImageError("That link can't be imported.");
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new RemoteImageError("Couldn't find that website.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
