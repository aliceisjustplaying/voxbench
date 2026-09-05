// Group IPv6 privacy addresses by /64; keep IPv4 addresses distinct.
export function networkGroup(ip: string): string {
  if (!ip.includes(':')) return ip;
  try {
    const host = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const [left, right] = host.split('::');
    const a = left ? left.split(':') : [];
    const b = right ? right.split(':') : [];
    const words =
      right === undefined
        ? a
        : [...a, ...Array<string>(8 - a.length - b.length).fill('0'), ...b];
    return (
      words
        .slice(0, 4)
        .map((word) => word.padStart(4, '0'))
        .join(':') + '::/64'
    );
  } catch {
    return ip;
  }
}
