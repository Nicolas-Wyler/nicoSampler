import { deflateRawSync } from "node:zlib";
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data) => {
  let c = 0xffffffff;
  for (const x of data) c = table[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/** Deterministic non-ZIP64 archive with UTF-8 names and preserved executable bits. */
export function zip(entries) {
  const locals = [],
    central = [];
  let offset = 0;
  const date = ((2026 - 1980) << 9) | (10 << 5) | 16;
  for (const entry of [...entries].sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    if (
      !entry.name ||
      entry.name.startsWith("/") ||
      entry.name.split("/").some((p) => !p || p === "." || p === "..") ||
      entry.name.includes("\\")
    )
      throw Error("Unsafe archive path");
    const name = Buffer.from(entry.name),
      data = Buffer.from(entry.data),
      compressed = deflateRawSync(data, { level: 9 }),
      crc = crc32(data);
    if (data.length > 0xffffffff || offset > 0xffffffff || name.length > 65535)
      throw Error("ZIP64 is not supported");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0x0314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE((((entry.mode ?? 0o100644) & 0xffff) << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + compressed.length;
  }
  if (entries.length > 65535) throw Error("Too many ZIP entries");
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
