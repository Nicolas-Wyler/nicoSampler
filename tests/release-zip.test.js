import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { zip } from '../scripts/lib/zip.mjs';

test('release ZIP preserves data, known CRC, UTF-8 names and launcher execute permission', () => {
  const archive = zip([{name:'é/Start.command',data:'123456789',mode:0o100755}]);
  assert.equal(archive.readUInt32LE(14),0xcbf43926);
  assert.equal(archive.readUInt16LE(6),0x800);
  const size=archive.readUInt32LE(18), nameLength=archive.readUInt16LE(26);
  assert.equal(archive.subarray(30,30+nameLength).toString(),'é/Start.command');
  assert.equal(inflateRawSync(archive.subarray(30+nameLength,30+nameLength+size)).toString(),'123456789');
  const central=30+nameLength+size;
  assert.equal(archive.readUInt32LE(central),0x02014b50);
  assert.equal(archive.readUInt32LE(central+38)>>>16,0o100755);
  assert.equal(archive.readUInt16LE(archive.length-12),1);
});
test('release ZIP rejects traversal and absolute paths', () => {
  for (const name of ['../secret','/secret','a/../secret','a\\secret','a//secret']) {
    assert.throws(()=>zip([{name,data:'x'}]),/Unsafe archive path/);
  }
});
