import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { ReadableStream as NodeReadableStream } from "node:stream/web";
import { assert, expectTypeOf, test } from "vitest";
import {
  fileTypeFromBlob,
  FileTypeParser,
  fileTypeStream,
  type FileTypeResult,
  type ReadableStreamWithFileType,
} from "../src";
import type { FileTypeResult as FileTypeResultBrowser } from "../src/core";
import { getFixtures } from "./test-utils";

test(`'fileTypeStream': accepts options merged from StreamOptions & FileTypeOptions`, async () => {
  const [fixture] = getFixtures();
  if (!fixture)
    assert.fail("Cannot find fixture for testing fileTypeStream types");

  const stream = createReadStream(fixture.path);
  expectTypeOf<ReadableStreamWithFileType>(
    await fileTypeStream(stream, { sampleSize: 256, customDetectors: [] }),
  );
});

test.skip("'FileTypeParser': tests generic input types and mixed options", async () => {
  const fileTypeParser = new FileTypeParser({ customDetectors: [] });
  const nodeStream = new Readable();
  const webStream = new ReadableStream<Uint8Array>();
  const nodeWebStream = new NodeReadableStream<Uint8Array>();

  expectTypeOf<FileTypeResult | undefined>(
    await fileTypeParser.fromStream(nodeStream),
  );
  expectTypeOf<FileTypeResult | undefined>(
    await fileTypeParser.fromStream(webStream),
  );
  expectTypeOf<FileTypeResult | undefined>(
    await fileTypeParser.fromStream(nodeWebStream),
  );

  expectTypeOf<ReadableStreamWithFileType>(
    await fileTypeParser.toDetectionStream(nodeStream, {
      sampleSize: 256,
      customDetectors: [],
    }),
  );
});

test("Test that Blob overload returns browser-specific result", () => {
  expectTypeOf<Promise<FileTypeResultBrowser | undefined>>(
    fileTypeFromBlob(new Blob([])),
  );
});
