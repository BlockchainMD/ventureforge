import { Readable } from 'node:stream';
import { parse as parseCsv } from 'csv-parse';
import { Unzip, UnzipInflate } from 'fflate';
import type { IngestHttpClient } from '../../fetch/http';

/**
 * Inflate a single-entry zip and hand back its CSV rows one at a time.
 *
 * fflate's streaming unzip feeds inflated chunks into a Node readable, which
 * csv-parse consumes incrementally. Nothing larger than a chunk is ever held,
 * which is what makes a 266MB roll tractable.
 */
export async function streamZippedCsv<T>(
  http: IngestHttpClient,
  url: string,
  signal: AbortSignal | undefined,
  onRow: (row: T) => void,
): Promise<void> {
  const response = await http.get(url);
  const archive = new Uint8Array(response.body);

  const inflated = new Readable({ read() {} });
  let entryOpened = false;
  let failure: Error | null = null;

  const unzip = new Unzip((file) => {
    // Every PTO roll archive holds exactly one CSV; ignore anything else so a
    // stray readme cannot be parsed as data.
    if (entryOpened || !/\.csv$/i.test(file.name)) return;
    entryOpened = true;
    file.ondata = (err, chunk, final) => {
      if (err) {
        failure = err instanceof Error ? err : new Error(String(err));
        inflated.destroy(failure);
        return;
      }
      if (chunk.length > 0) inflated.push(Buffer.from(chunk));
      if (final) inflated.push(null);
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  const parser = parseCsv({
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
    trim: true,
  });

  const consuming = (async () => {
    for await (const row of inflated.pipe(parser)) {
      if (signal?.aborted) break;
      onRow(row as T);
    }
  })();

  // Push the archive through in slices so the inflater yields to the consumer
  // rather than producing the whole entry before anything is read.
  const SLICE = 1 << 20;
  for (let offset = 0; offset < archive.length; offset += SLICE) {
    const end = Math.min(offset + SLICE, archive.length);
    unzip.push(archive.subarray(offset, end), end === archive.length);
    if (failure) break;
  }
  if (!entryOpened && !failure) {
    inflated.push(null);
    throw new Error(`No CSV entry found in ${url}`);
  }

  await consuming;
  if (failure) throw failure;
}
