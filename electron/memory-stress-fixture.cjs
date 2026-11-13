const chunks = [];
const chunkSize = 4 * 1024 * 1024;
function allocate() {
  const block = Buffer.allocUnsafe(chunkSize);
  for (let offset = 0; offset < block.length; offset += 4096) block[offset] = 0x5a;
  chunks.push(block);
  setTimeout(allocate, 100);
}
allocate();
