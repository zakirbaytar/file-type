import { describe, it, expect, assert } from "vitest";
import { Parser as ReadmeParser } from "commonmark";
import { createReadStream, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { readableNoopStream } from "noop-stream";
import * as strtok3 from "strtok3/core";
import { areUint8ArraysEqual } from "uint8array-extras";
import {
  fileTypeFromBlob,
  fileTypeFromBuffer,
  fileTypeFromFile,
  fileTypeFromStream as fileTypeNodeFromStream,
  FileTypeParser,
  fileTypeStream,
  supportedExtensions,
  supportedMimeTypes,
} from "../src";
import type { Detector } from "../src/core";
import { stringToBytes } from "../src/util";
import {
  failingFixture,
  falsePositives,
  getFixtures,
  getStreamAsUint8Array,
} from "./test-utils";

describe("file-type", () => {
  const [nodeMajorVersion] = process.versions.node.split(".").map(Number);
  const nodeVersionSupportingByteBlobStream = 20;
  let testCounter = 0;

  const fixtures = getFixtures();

  it("test suite must be able to detect Node.js major version", () => {
    expect(typeof nodeMajorVersion).toBe("number");
  });

  describe.each(fixtures)("$type", (fixture) => {
    const test = failingFixture.has(fixture.filename) ? it.fails : it;

    async function checkBufferLike(
      expectedExtension: string,
      bufferLike: Uint8Array | ArrayBuffer,
    ) {
      const { ext, mime } = (await fileTypeFromBuffer(bufferLike)) ?? {};
      expect(ext).toBe(expectedExtension);
      expect(typeof mime).toBe("string");
    }

    async function checkBlobLike(
      expectedExtension: string,
      bufferLike: Uint8Array | ArrayBuffer,
    ) {
      const blob = new Blob([bufferLike]);
      const { ext, mime } = (await fileTypeFromBlob(blob)) ?? {};
      expect(ext).toBe(expectedExtension);
      expect(typeof mime).toBe("string");
    }

    it(`${fixture.filename} ${testCounter++} .fileTypeFromFile() method - same fileType`, async () => {
      const { ext, mime } = (await fileTypeFromFile(fixture.path)) ?? {};
      expect(ext).toBe(fixture.type);
      expect(typeof mime).toBe("string");
    });

    it(`${fixture.filename} ${testCounter++} .fileTypeFromBuffer() method - same fileType`, async () => {
      const chunk = readFileSync(fixture.path);

      await checkBufferLike(fixture.type, chunk);
      await checkBufferLike(fixture.type, new Uint8Array(chunk));
      await checkBufferLike(
        fixture.type,
        chunk.buffer.slice(
          chunk.byteOffset,
          chunk.byteOffset + chunk.byteLength,
        ),
      );
    });

    if (
      nodeMajorVersion &&
      nodeMajorVersion >= nodeVersionSupportingByteBlobStream
    ) {
      test(`${fixture.filename} ${testCounter++} .fileTypeFromBlob() method - same fileType`, async () => {
        const chunk = readFileSync(fixture.path);
        await checkBlobLike(fixture.type, chunk);
      });

      test(`${fixture.filename} ${testCounter++} .fileTypeStream() - identical Web Streams`, async () => {
        const fileBuffer = readFileSync(fixture.path);
        const blob = new Blob([fileBuffer]);
        const webStream = await fileTypeStream(blob.stream());
        expect(webStream.locked).toBe(false);

        const webStreamResult = await getStreamAsUint8Array(webStream);
        expect(webStream.locked).toBe(false);
        expect(areUint8ArraysEqual(fileBuffer, webStreamResult)).toBe(true);
      });
    }

    test(`${fixture.filename} ${testCounter++} .fileTypeFromStream() Node.js method - same fileType`, async () => {
      const fileType = await fileTypeNodeFromStream(
        createReadStream(fixture.path),
      );

      assert(fileType);
      expect(fileType.ext).toBe(fixture.type);
      expect(typeof fileType.mime).toBe("string");
    });

    const falsePositiveFiles = falsePositives[fixture.filename];

    if (falsePositiveFiles) {
      for (const _falsePositiveFile of falsePositiveFiles) {
        test(`false positive - ${fixture.filename} ${testCounter++}`, async () => {
          expect(await fileTypeFromFile(fixture.path)).toBeUndefined();

          const chunk = readFileSync(fixture.path);
          expect(await fileTypeFromBuffer(chunk)).toBeUndefined();
          expect(await fileTypeFromBuffer(new Uint8Array(chunk))).toBe(
            undefined,
          );
          expect(await fileTypeFromBuffer(chunk.buffer)).toBeUndefined();
        });
      }
    }
  });

  it(".fileTypeStream() method - empty stream", async () => {
    const newStream = await fileTypeStream(readableNoopStream() as Readable);
    expect(newStream.fileType).toBeUndefined();
  });

  it(".fileTypeStream() method - short stream", async () => {
    const bufferA = new Uint8Array([0, 1, 0, 1]);
    class MyStream extends Readable {
      _read() {
        this.push(bufferA);
        this.push(null);
      }
    }

    // Test filetype detection
    const shortStream = new MyStream();
    const newStream = await fileTypeStream(shortStream);
    expect(newStream.fileType).toBeUndefined();

    // Test usability of returned stream
    const bufferB = await getStreamAsUint8Array(newStream);
    expect(bufferA).toEqual(bufferB);
  });

  it(".fileTypeStream() method - no end-of-stream errors", async () => {
    const file = join(__dirname, "fixture", "fixture.ogm");
    const stream = await fileTypeStream(createReadStream(file), {
      sampleSize: 30,
    });
    expect(stream.fileType).toBeUndefined();
  });

  it(".fileTypeStream() method - error event", async () => {
    const errorMessage = "Fixture";

    const readableStream = new Readable({
      read() {
        process.nextTick(() => {
          this.emit("error", new Error(errorMessage));
        });
      },
    });

    await expect(fileTypeStream(readableStream)).rejects.toThrow(errorMessage);
  });

  it(".fileTypeStream() method - sampleSize option", async () => {
    const file = join(__dirname, "fixture", "fixture.ogm");
    let stream = await fileTypeStream(createReadStream(file), {
      sampleSize: 30,
    });
    expect(stream.fileType).toBeUndefined();

    stream = await fileTypeStream(createReadStream(file), {
      sampleSize: 4100,
    });
    assert(stream.fileType);
    expect(stream.fileType.mime).toBe("video/ogg");
  });

  it(".fileTypeFromStream() method - be able to abort operation", async () => {
    const bufferA = new Uint8Array([0, 1, 0, 1]);
    class MyStream extends Readable {
      _read() {
        setTimeout(() => {
          this.push(bufferA);
          this.push(null);
        }, 500);
      }
    }

    const shortStream = new MyStream();
    const abortController = new AbortController();
    const parser = new FileTypeParser({ signal: abortController.signal });
    const promiseFileType = parser.fromStream(shortStream);
    abortController.abort(); // Abort asynchronous operation: reading from shortStream
    await expect(promiseFileType).rejects.toThrow(strtok3.AbortError);
  });

  it("supportedExtensions.has", () => {
    expect(supportedExtensions.has("jpg")).toBe(true);
    expect(supportedExtensions.has("blah")).toBe(false);
  });

  it("supportedMimeTypes.has", () => {
    expect(supportedMimeTypes.has("video/mpeg")).toBe(true);
    expect(supportedMimeTypes.has("video/blah")).toBe(false);
  });

  it("validate the input argument type", async () => {
    await expect(fileTypeFromBuffer("x" as never)).rejects.toThrow(
      /Expected the `input` argument to be of type `Uint8Array`/,
    );

    await expect(fileTypeFromBuffer(new Uint8Array())).resolves.not.toThrow();

    await expect(fileTypeFromBuffer(new ArrayBuffer())).resolves.not.toThrow();
  });

  it("validate the repo has all extensions and mimes in sync", () => {
    function readIndexJS() {
      const corePath = join(__dirname, "..", "src", "core.ts");
      const core = readFileSync(corePath, { encoding: "utf8" });
      const extensionArray = core.match(/(?<=ext:\s")(.*)(?=",)/g);
      const mimeArray = core.match(/(?<=mime:\s")(.*)(?=")/g);
      const extensions = new Set(extensionArray);
      const mimes = new Set(mimeArray);

      return {
        exts: extensions,
        mimes,
      };
    }

    // File: package.json
    function readPackageJSON() {
      const packageJson = readFileSync("package.json", { encoding: "utf8" });
      const { keywords } = JSON.parse(packageJson);

      if (!Array.isArray(keywords)) {
        return [];
      }

      const allowedExtras = new Set([
        "mime",
        "file",
        "type",
        "magic",
        "archive",
        "image",
        "img",
        "pic",
        "picture",
        "flash",
        "photo",
        "video",
        "detect",
        "check",
        "is",
        "exif",
        "binary",
        "buffer",
        "uint8array",
        "webassembly",
      ]);

      const extensionArray = keywords.filter(
        (keyword) => !allowedExtras.has(keyword),
      );
      return extensionArray;
    }

    // File: readme.md
    function readReadmeMD() {
      const index = readFileSync("readme.md", { encoding: "utf8" });
      const extensionArray = index.match(/(?<=-\s\[`)(.*)(?=`)/g);
      if (!extensionArray) return [];

      return [...extensionArray];
    }

    // Helpers
    // Find extensions/mimes that are defined twice in a file
    function findDuplicates<T>(input: T[]) {
      return input.reduce<T[]>((accumulator, element, index, array) => {
        if (
          array.indexOf(element) !== index &&
          !accumulator.includes(element)
        ) {
          accumulator.push(element);
        }

        return accumulator;
      }, []);
    }

    // Find extensions/mimes that are in another file but not in `core.js`
    function findExtras(array: unknown[], set: Set<unknown>) {
      return array.filter((element) => !set.has(element));
    }

    // Find extensions/mimes that are in `core.js` but missing from another file
    function findMissing(array: unknown[], set: Set<unknown>) {
      const missing = [];
      const other = new Set(array);
      for (const element of set) {
        if (!other.has(element)) {
          missing.push(element);
        }
      }

      return missing;
    }

    // Test runner
    function validate(found: unknown[], baseTruth: Set<unknown>) {
      const duplicates = findDuplicates(found);
      const extras = findExtras(found, baseTruth);
      const missing = findMissing(found, baseTruth);

      expect(duplicates).toHaveLength(0);
      expect(extras).toHaveLength(0);
      expect(missing).toHaveLength(0);
    }

    // Get the base truth of extensions and mimes supported from core.js
    const { exts } = readIndexJS();

    // Validate all extensions
    const filesWithExtensions: Record<string, string[]> = {
      "supported.js": [...supportedExtensions],
      "package.json": readPackageJSON(),
      "readme.md": readReadmeMD(),
    };

    for (const filename in filesWithExtensions) {
      if (filesWithExtensions[filename]) {
        const foundExtensions = filesWithExtensions[filename];
        validate(foundExtensions, exts);
      }
    }
  });

  class BufferedStream extends Readable {
    constructor(buffer: Uint8Array) {
      super();
      this.push(buffer);
      this.push(null);
    }

    _read() {}
  }

  it("odd file sizes", async () => {
    const oddFileSizes = [
      1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 255, 256, 257, 511, 512, 513,
    ];

    for (const size of oddFileSizes) {
      const buffer = new Uint8Array(size);
      await expect(fileTypeFromBuffer(buffer)).resolves.not.toThrow();
    }

    for (const size of oddFileSizes) {
      const buffer = new Uint8Array(size);
      const stream = new BufferedStream(buffer);
      await expect(fileTypeNodeFromStream(stream)).resolves.not.toThrow();
    }
  });

  it("supported files types are listed alphabetically", async () => {
    const readme = await readFile("readme.md", { encoding: "utf8" });
    let currentNode = new ReadmeParser().parse(readme).firstChild;

    while (currentNode) {
      if (
        currentNode.type === "heading" &&
        currentNode.firstChild?.literal === "Supported file types"
      ) {
        // Header → List → First list item
        currentNode = currentNode.next?.firstChild ?? null;
        break;
      }

      currentNode = currentNode.next;
    }

    let previousFileType: string | undefined;

    while (currentNode) {
      // List item → Paragraph → Link → Inline code → Text
      const currentFileType =
        currentNode.firstChild?.firstChild?.firstChild?.literal ?? undefined;

      if (previousFileType) {
        expect(currentFileType && currentFileType > previousFileType).toBe(
          true,
        );
      }

      previousFileType = currentFileType;
      currentNode = currentNode.next;
    }
  });

  // TODO: Replace with `Set.symmetricDifference` when targeting Node.js 22.
  function symmetricDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
    const diff = new Set<T>();
    for (const item of setA) {
      if (!setB.has(item)) {
        diff.add(item);
      }
    }

    for (const item of setB) {
      if (!setA.has(item)) {
        diff.add(item);
      }
    }

    return diff;
  }

  it("implemented MIME types and extensions match the list of supported ones", async () => {
    const mimeTypesWithoutUnitTest = [
      "application/vnd.ms-asf",
      "image/heic-sequence",
    ];

    const implementedMimeTypes = new Set(mimeTypesWithoutUnitTest);
    const implementedExtensions = new Set<string>();

    for (const { path } of getFixtures()) {
      const fileType = await fileTypeFromFile(path);
      if (fileType) {
        implementedMimeTypes.add(fileType.mime);
        implementedExtensions.add(fileType.ext);
      }
    }

    const differencesInMimeTypes = symmetricDifference(
      supportedMimeTypes,
      implementedMimeTypes,
    );

    for (const difference of differencesInMimeTypes) {
      if (implementedMimeTypes.has(difference)) {
        assert.fail(
          `MIME-type ${difference} is implemented, but not declared as a supported MIME-type`,
        );
      } else {
        assert.fail(
          `MIME-type ${difference} declared as a supported MIME-type, but not found as an implemented MIME-type`,
        );
      }
    }

    expect(differencesInMimeTypes.size).toBe(0);

    const differencesInExtensions = symmetricDifference(
      supportedExtensions,
      implementedExtensions,
    );
    for (const difference of differencesInExtensions) {
      if (implementedMimeTypes.has(difference)) {
        assert.fail(
          `Extension ${difference} is implemented, but not declared as a supported extension`,
        );
      } else {
        assert.fail(
          `Extension ${difference} declared as a supported extension, but not found as an implemented extension`,
        );
      }
    }

    expect(differencesInExtensions.size).toBe(0);
  });

  it("corrupt MKV throws", async () => {
    const filePath = join(__dirname, "fixture/fixture-corrupt.mkv");
    await expect(fileTypeFromFile(filePath)).rejects.toThrow(/End-Of-Stream/);
  });

  // Create a custom detector for the just made up "unicorn" file type
  const unicornDetector: Detector = {
    id: "mock.unicorn",
    async detect(tokenizer: strtok3.ITokenizer) {
      const unicornHeader = [85, 78, 73, 67, 79, 82, 78]; // "UNICORN" as decimal string
      const buffer = new Uint8Array(7);
      await tokenizer.peekBuffer(buffer, {
        length: unicornHeader.length,
        mayBeLess: true,
      });
      if (unicornHeader.every((value, index) => value === buffer[index])) {
        return { ext: "unicorn", mime: "application/unicorn" };
      }

      return undefined;
    },
  };

  const mockPngDetector: Detector = {
    id: "mock.png",
    async detect() {
      return { ext: "mockPng", mime: "image/mockPng" };
    },
  };

  const tokenizerPositionChanger: Detector = {
    id: "mock.dirtyTokenizer",
    async detect(tokenizer: strtok3.ITokenizer) {
      const buffer = new Uint8Array(1);
      tokenizer.readBuffer(buffer, { length: 1, mayBeLess: true });
      return undefined;
    },
  };

  if (
    nodeMajorVersion &&
    nodeMajorVersion >= nodeVersionSupportingByteBlobStream
  ) {
    // Blob requires to stream to BYOB ReadableStream, requiring Node.js ≥ 20

    it('fileTypeFromBlob should detect custom file type "unicorn" using custom detectors', async () => {
      // Set up the "unicorn" file content
      const header = "UNICORN FILE\n";
      const blob = new Blob([header]);

      const customDetectors = [unicornDetector];
      const parser = new FileTypeParser({ customDetectors });

      const result = await parser.fromBlob(blob);
      expect(result).toEqual({ ext: "unicorn", mime: "application/unicorn" });
    });

    it("fileTypeFromBlob should keep detecting default file types when no custom detector matches", async () => {
      const file = join(__dirname, "fixture", "fixture.png");
      const chunk = readFileSync(file);
      const blob = new Blob([chunk]);

      const customDetectors = [unicornDetector];
      const parser = new FileTypeParser({ customDetectors });

      const result = await parser.fromBlob(blob);
      expect(result).toEqual({ ext: "png", mime: "image/png" });
    });

    it("fileTypeFromBlob should allow overriding default file type detectors", async () => {
      const file = join(__dirname, "fixture", "fixture.png");
      const chunk = readFileSync(file);
      const blob = new Blob([chunk]);

      const customDetectors = [mockPngDetector];
      const parser = new FileTypeParser({ customDetectors });

      const result = await parser.fromBlob(blob);
      expect(result).toEqual({ ext: "mockPng", mime: "image/mockPng" });
    });
  }

  it('fileTypeFromBuffer should detect custom file type "unicorn" using custom detectors', async () => {
    const header = "UNICORN FILE\n";
    const uint8ArrayContent = new TextEncoder().encode(header);

    const customDetectors = [unicornDetector];
    const parser = new FileTypeParser({ customDetectors });

    const result = await parser.fromBuffer(uint8ArrayContent);
    expect(result).toEqual({ ext: "unicorn", mime: "application/unicorn" });
  });

  it("fileTypeFromBuffer should keep detecting default file types when no custom detector matches", async () => {
    const file = join(__dirname, "fixture", "fixture.png");
    const uint8ArrayContent = readFileSync(file);

    const customDetectors = [unicornDetector];
    const parser = new FileTypeParser({ customDetectors });

    const result = await parser.fromBuffer(uint8ArrayContent);
    expect(result).toEqual({ ext: "png", mime: "image/png" });
  });

  it("fileTypeFromBuffer should allow overriding default file type detectors", async () => {
    const file = join(__dirname, "fixture", "fixture.png");
    const uint8ArrayContent = readFileSync(file);

    const customDetectors = [mockPngDetector];
    const parser = new FileTypeParser({ customDetectors });

    const result = await parser.fromBuffer(uint8ArrayContent);
    expect(result).toEqual({ ext: "mockPng", mime: "image/mockPng" });
  });

  class CustomReadableStream extends Readable {
    _read() {
      this.push("UNICORN");
    }
  }
  it('fileTypeFromStream should detect custom file type "unicorn" using custom detectors', async () => {
    const readableStream = new CustomReadableStream();

    const customDetectors = [unicornDetector];
    const parser = new FileTypeParser({ customDetectors });

    const result = await parser.fromStream(readableStream);
    expect(result).toEqual({ ext: "unicorn", mime: "application/unicorn" });
  });

  it("fileTypeFromStream should keep detecting default file types when no custom detector matches", async () => {
    const file = join(__dirname, "fixture", "fixture.png");
    const readableStream = createReadStream(file);

    const customDetectors = [unicornDetector];
    const parser = new FileTypeParser({ customDetectors });

    const result = await parser.fromStream(readableStream);
    expect(result).toEqual({ ext: "png", mime: "image/png" });
  });

  it("fileTypeFromStream should allow overriding default file type detectors", async () => {
    const file = join(__dirname, "fixture", "fixture.png");
    const readableStream = createReadStream(file);

    const customDetectors = [mockPngDetector];
    const parser = new FileTypeParser({ customDetectors });

    const result = await parser.fromStream(readableStream);
    expect(result).toEqual({ ext: "mockPng", mime: "image/mockPng" });
  });

  it('fileTypeFromFile should detect custom file type "unicorn" using custom detectors', async () => {
    const file = join(__dirname, "fixture", "fixture.unicorn");

    const customDetectors = [unicornDetector];

    const result = await fileTypeFromFile(file, { customDetectors });
    expect(result).toEqual({ ext: "unicorn", mime: "application/unicorn" });
  });

  it("fileTypeFromFile should keep detecting default file types when no custom detector matches", async () => {
    const file = join(__dirname, "fixture", "fixture.png");

    const customDetectors = [unicornDetector];

    const result = await fileTypeFromFile(file, { customDetectors });
    expect(result).toEqual({ ext: "png", mime: "image/png" });
  });

  it("fileTypeFromFile should allow overriding default file type detectors", async () => {
    const file = join(__dirname, "fixture", "fixture.png");

    const customDetectors = [mockPngDetector];

    const result = await fileTypeFromFile(file, { customDetectors });
    expect(result).toEqual({ ext: "mockPng", mime: "image/mockPng" });
  });

  it("fileTypeFromTokenizer should return undefined when a custom detector changes the tokenizer position and does not return a file type", async () => {
    const header = "UNICORN FILE\n";
    const uint8ArrayContent = new TextEncoder().encode(header);

    // Include the unicornDetector here to verify it's not used after the tokenizer.position changed
    const customDetectors = [tokenizerPositionChanger, unicornDetector];
    const parser = new FileTypeParser({ customDetectors });

    const result = await parser.fromTokenizer(
      strtok3.fromBuffer(uint8ArrayContent),
    );
    expect(result).toBeUndefined();
  });

  it("should detect MPEG frame which is out of sync with the mpegOffsetTolerance option", async () => {
    const badOffset1Path = join(__dirname, "fixture", "fixture-bad-offset.mp3");
    const badOffset10Path = join(
      __dirname,
      "fixture",
      "fixture-bad-offset-10.mp3",
    );

    let result = await fileTypeFromFile(badOffset1Path);
    expect(result).toBeUndefined();

    result = await fileTypeFromFile(badOffset1Path, { mpegOffsetTolerance: 1 });
    expect(result).toEqual({ ext: "mp3", mime: "audio/mpeg" });

    result = await fileTypeFromFile(badOffset10Path);
    expect(result).toBeUndefined();

    result = await fileTypeFromFile(badOffset10Path, {
      mpegOffsetTolerance: 10,
    });
    expect(result).toEqual({ ext: "mp3", mime: "audio/mpeg" });
  });

  function loopEncoding(stringValue: string, encoding: string) {
    expect(
      new TextDecoder(encoding).decode(
        new Uint8Array(stringToBytes(stringValue, encoding)),
      ),
    ).toBe(stringValue);
  }

  it("stringToBytes encodes correctly for selected characters and encodings", () => {
    // Default encoding: basic ASCII
    expect(stringToBytes("ABC")).toEqual([65, 66, 67]);

    // UTF-16LE with character above 0xFF
    expect(stringToBytes("ꟻ", "utf-16le")).toEqual([0xfb, 0xa7]);

    // UTF-16BE with character above 0xFF
    expect(stringToBytes("ꟻ", "utf-16be")).toEqual([0xa7, 0xfb]);

    // UTF-16LE with surrogate pair (🦄)
    expect(stringToBytes("🦄", "utf-16le")).toEqual([0x3e, 0xd8, 0x84, 0xdd]);

    // UTF-16BE with surrogate pair (🦄)
    expect(stringToBytes("🦄", "utf-16be")).toEqual([0xd8, 0x3e, 0xdd, 0x84]);

    loopEncoding("🦄", "utf-16le");
    loopEncoding("🦄", "utf-16be");

    expect(
      new TextDecoder("utf-16be").decode(
        new Uint8Array(stringToBytes("🦄", "utf-16be")),
      ),
    ).toBe("🦄");
  });
});
