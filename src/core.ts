import { GzipHandler, ZipHandler } from "@tokenizer/inflate";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import * as strtok3 from "strtok3";
import * as Token from "token-types";
import { getUintBE } from "uint8array-extras";
import { extensions, mimeTypes } from "./supported";
import {
  stringToBytes,
  tarHeaderChecksumMatches,
  uint32SyncSafeToken,
} from "./util";

export type FileTypeResult = {
  /**
   * 	One of the supported [file types](https://github.com/sindresorhus/file-type#supported-file-types).
   */
  readonly ext: string;

  /**
   * 	The detected [MIME type](https://en.wikipedia.org/wiki/Internet_media_type).
   */
  readonly mime: string;
};

export class TokenizerPositionError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "TokenizerPositionError";
  }
}

export type AnyWebReadableStream<G> = WebReadableStream<G> | ReadableStream<G>;

export type AnyWebReadableByteStreamWithFileType =
  AnyWebReadableStream<Uint8Array> & {
    fileType?: FileTypeResult;
  };

export type StreamOptions = {
  /**
   * 	The default sample size in bytes.
   *
   * 	@default 4100
   */
  readonly sampleSize?: number;
};

/**
 * A custom file type detector.
 *
 * Custom file type detectors are plugins designed to extend the default detection capabilities. \
 * They allow support for uncommon file types, non-binary formats, or customized detection behavior.
 *
 * Detectors can be added via the constructor options or by modifying `FileTypeParser#detectors` directly. \
 * Detectors provided through the constructor are executed before the default ones.
 *
 * Detectors can be added via the constructor options or by directly modifying `FileTypeParser#detectors`.
 *
 * ### Example adding a detector
 *
 * ```js
 * import {FileTypeParser} from 'file-type';
 * import {detectXml} from '@file-type/xml';
 * const parser = new FileTypeParser({customDetectors: [detectXml]});
 * const fileType = await parser.fromFile('sample.kml');
 * console.log(fileType);
 * ```
 *
 * ### Available-third party file-type detectors
 *
 * - [@file-type/xml](https://github.com/Borewit/file-type-xml): Detects common XML file types, such as GLM, KML, MusicXML, RSS, SVG, and XHTML
 *
 * ### Detector execution flow
 *
 * If a detector returns `undefined`, the following rules apply:
 *
 * 1. **No Tokenizer Interaction**: If the detector does not modify the tokenizer's position, the next detector in the sequence is executed.
 * 2. **Tokenizer Interaction**: If the detector modifies the tokenizer's position (`tokenizer.position` is advanced), no further detectors are executed. In this case, the file type remains `undefined`, as subsequent detectors cannot evaluate the content. This is an exceptional scenario, as it prevents any other detectors from determining the file type.
 *
 * ### Example writing a custom detector
 *
 * Below is an example of a custom detector array. This can be passed to the `FileTypeParser` via the `fileTypeOptions` argument.
 *
 * ```
 * import {FileTypeParser} from 'file-type';
 *
 * const customDetectors = [
 * 	async tokenizer => {
 * 		const unicornHeader = [85, 78, 73, 67, 79, 82, 78]; // "UNICORN" in ASCII decimal
 *
 * 		const buffer = new Uint8Array(unicornHeader.length);
 * 		await tokenizer.peekBuffer(buffer, {length: unicornHeader.length, mayBeLess: true});
 * 		if (unicornHeader.every((value, index) => value === buffer[index])) {
 * 			return {ext: 'unicorn', mime: 'application/unicorn'};
 * 		}
 *
 * 		return undefined;
 * 	},
 * ];
 *
 * const buffer = new Uint8Array([85, 78, 73, 67, 79, 82, 78]);
 * const parser = new FileTypeParser({customDetectors});
 * const fileType = await parser.fromBuffer(buffer);
 * console.log(fileType); // {ext: 'unicorn', mime: 'application/unicorn'}
 * ```
 *
 * @param tokenizer - The [tokenizer](https://github.com/Borewit/strtok3#tokenizer) used to read file content.
 * @param fileType - The file type detected by standard or previous custom detectors, or `undefined` if no match is found.
 * @returns The detected file type, or `undefined` if no match is found.
 */
export type Detector = {
  id: string;
  detect: (
    tokenizer: strtok3.ITokenizer,
    fileType?: FileTypeResult,
  ) => Promise<FileTypeResult | undefined>;
};

export type FileTypeOptions = {
  customDetectors?: Iterable<Detector>;

  /**
   * 	Specifies the byte tolerance for locating the first MPEG audio frame (e.g. `.mp1`, `.mp2`, `.mp3`, `.aac`).
   *
   * 	Allows detection to handle slight sync offsets between the expected and actual frame start. Common in malformed or incorrectly muxed files, which, while technically invalid, do occur in the wild.
   *
   * 	A tolerance of 10 bytes covers most cases.
   *
   *  @default 0
   */
  mpegOffsetTolerance?: number;
};

export const reasonableDetectionSizeInBytes = 4100; // A fair amount of file-types are detectable within this range.

/**
 * Detect the file type of a [web `ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
 *
 * The file type is detected by checking the [magic number](https://en.wikipedia.org/wiki/Magic_number_(programming)#Magic_numbers_in_files) of the buffer.
 *
 * @param stream - A [web `ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) streaming a file to examine.
 * @param options - Options to override default behavior.
 *
 * @returns A `Promise` for an object with the detected file type, or `undefined` when there is no match.
 */
export function fileTypeFromStream(
  stream: strtok3.AnyWebByteStream,
  options?: FileTypeOptions & StreamOptions & strtok3.ITokenizerOptions,
): Promise<FileTypeResult | undefined> {
  return new FileTypeParser(options).fromStream(stream);
}

/**
 * Detect the file type of a `Uint8Array` or `ArrayBuffer`.
 *
 * The file type is detected by checking the [magic number](https://en.wikipedia.org/wiki/Magic_number_(programming)#Magic_numbers_in_files) of the buffer.
 *
 * If file access is available, it is recommended to use `.fromFile()` instead.
 *
 * @param buffer - An Uint8Array or ArrayBuffer representing file data. It works best if the buffer contains the entire file. It may work with a smaller portion as well.
 * @param options - Options to override default behavior.
 * @returns The detected file type, or `undefined` when there is no match.
 */
export function fileTypeFromBuffer(
  buffer: Uint8Array | ArrayBuffer,
  options?: FileTypeOptions,
): Promise<FileTypeResult | undefined> {
  return new FileTypeParser(options).fromBuffer(buffer);
}

/**
 * Detect the file type of a [`Blob`](https://nodejs.org/api/buffer.html#class-blob) or [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File).
 *
 * @param blob - The [`Blob`](https://nodejs.org/api/buffer.html#class-blob) used for file detection.
 * @param options - Options to override default behavior.
 * @returns The detected file type, or `undefined` when there is no match.
 *
 * @example
 * ```
 * import {fileTypeFromBlob} from 'file-type';
 *
 * const blob = new Blob(['<?xml version="1.0" encoding="ISO-8859-1" ?>'], {
 *     type: 'text/plain',
 *     endings: 'native'
 * });
 *
 * console.log(await fileTypeFromBlob(blob));
 * //=> {ext: 'txt', mime: 'text/plain'}
 * ```
 */
export function fileTypeFromBlob(
  blob: Blob,
  options?: FileTypeOptions,
): Promise<FileTypeResult | undefined> {
  return new FileTypeParser(options).fromBlob(blob);
}

function getFileTypeFromMimeType(mimeType: string): FileTypeResult | undefined {
  mimeType = mimeType.toLowerCase();
  switch (mimeType) {
    case "application/epub+zip":
      return {
        ext: "epub",
        mime: mimeType,
      };
    case "application/vnd.oasis.opendocument.text":
      return {
        ext: "odt",
        mime: mimeType,
      };
    case "application/vnd.oasis.opendocument.text-template":
      return {
        ext: "ott",
        mime: mimeType,
      };
    case "application/vnd.oasis.opendocument.spreadsheet":
      return {
        ext: "ods",
        mime: mimeType,
      };
    case "application/vnd.oasis.opendocument.spreadsheet-template":
      return {
        ext: "ots",
        mime: mimeType,
      };
    case "application/vnd.oasis.opendocument.presentation":
      return {
        ext: "odp",
        mime: mimeType,
      };
    case "application/vnd.oasis.opendocument.presentation-template":
      return {
        ext: "otp",
        mime: mimeType,
      };
    case "application/vnd.oasis.opendocument.graphics":
      return {
        ext: "odg",
        mime: mimeType,
      };
    case "application/vnd.oasis.opendocument.graphics-template":
      return {
        ext: "otg",
        mime: mimeType,
      };
    case "application/vnd.openxmlformats-officedocument.presentationml.slideshow":
      return {
        ext: "ppsx",
        mime: mimeType,
      };
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return {
        ext: "xlsx",
        mime: mimeType,
      };
    case "application/vnd.ms-excel.sheet.macroenabled":
      return {
        ext: "xlsm",
        mime: "application/vnd.ms-excel.sheet.macroenabled.12",
      };
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.template":
      return {
        ext: "xltx",
        mime: mimeType,
      };
    case "application/vnd.ms-excel.template.macroenabled":
      return {
        ext: "xltm",
        mime: "application/vnd.ms-excel.template.macroenabled.12",
      };
    case "application/vnd.ms-powerpoint.slideshow.macroenabled":
      return {
        ext: "ppsm",
        mime: "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
      };
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return {
        ext: "docx",
        mime: mimeType,
      };
    case "application/vnd.ms-word.document.macroenabled":
      return {
        ext: "docm",
        mime: "application/vnd.ms-word.document.macroenabled.12",
      };
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.template":
      return {
        ext: "dotx",
        mime: mimeType,
      };
    case "application/vnd.ms-word.template.macroenabledtemplate":
      return {
        ext: "dotm",
        mime: "application/vnd.ms-word.template.macroenabled.12",
      };
    case "application/vnd.openxmlformats-officedocument.presentationml.template":
      return {
        ext: "potx",
        mime: mimeType,
      };
    case "application/vnd.ms-powerpoint.template.macroenabled":
      return {
        ext: "potm",
        mime: "application/vnd.ms-powerpoint.template.macroenabled.12",
      };
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return {
        ext: "pptx",
        mime: mimeType,
      };
    case "application/vnd.ms-powerpoint.presentation.macroenabled":
      return {
        ext: "pptm",
        mime: "application/vnd.ms-powerpoint.presentation.macroenabled.12",
      };
    case "application/vnd.ms-visio.drawing":
      return {
        ext: "vsdx",
        mime: "application/vnd.visio",
      };
    case "application/vnd.ms-package.3dmanufacturing-3dmodel+xml":
      return {
        ext: "3mf",
        mime: "model/3mf",
      };
    default:
      return undefined;
  }
}

function _check(
  buffer: Uint8Array,
  headers: number[],
  { offset, mask }: { offset?: number; mask?: number[] } = {},
) {
  const options = {
    offset: offset ?? 0,
    mask,
  };

  for (const [index, header] of headers.entries()) {
    // If a bitmask is set
    if (mask) {
      const maskBit = mask[index] ?? 0;
      const bit = buffer[index + options.offset] ?? 0;

      // If header doesn't equal `buf` with bits masked off
      if (header !== (maskBit & bit)) {
        return false;
      }
    } else if (header !== buffer[index + options.offset]) {
      return false;
    }
  }

  return true;
}

/**
 * Detect the file type from an [`ITokenizer`](https://github.com/Borewit/strtok3#tokenizer) source.
 *
 * This method is used internally, but can also be used for a special "tokenizer" reader.
 *
 * A tokenizer propagates the internal read functions, allowing alternative transport mechanisms to access files to be implemented and used.
 *
 * @param tokenizer - File source implementing the tokenizer interface.
 * @param options - Options to override default behavior.
 * @returns The detected file type, or `undefined` when there is no match.
 *
 * An example is [`@tokenizer/http`](https://github.com/Borewit/tokenizer-http), which requests data using [HTTP-range-requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests).
 * A difference with a conventional stream and the [*tokenizer*](https://github.com/Borewit/strtok3#tokenizer) is that it is able to *ignore* (seek, fast-forward) in the stream.
 * For example, you may only need and read the first 6 bytes, and the last 128 bytes, which may be an advantage in case reading the entire file would take longer.
 *
 * @example
 * ```
 * import {makeTokenizer} from '@tokenizer/http';
 * import {fileTypeFromTokenizer} from 'file-type';
 *
 * const audioTrackUrl = 'https://test-audio.netlify.com/Various%20Artists%20-%202009%20-%20netBloc%20Vol%2024_%20tiuqottigeloot%20%5BMP3-V2%5D/01%20-%20Diablo%20Swing%20Orchestra%20-%20Heroines.mp3';
 *
 * const httpTokenizer = await makeTokenizer(audioTrackUrl);
 * const fileType = await fileTypeFromTokenizer(httpTokenizer);
 *
 * console.log(fileType);
 * //=> {ext: 'mp3', mime: 'audio/mpeg'}
 * ```
 */
export function fileTypeFromTokenizer(
  tokenizer: strtok3.ITokenizer,
  options?: FileTypeOptions,
): Promise<FileTypeResult | undefined> {
  return new FileTypeParser(options).fromTokenizer(tokenizer);
}

/**
 * Returns a `Promise` which resolves to the original readable stream argument, but with an added `fileType` property.
 * The `fileType` property is an object similar to the one returned from `fileTypeFromFile()`.
 *
 * This method is useful in a stream pipeline, but note that it builds up a buffer of `sampleSize` bytes internally to determine the file type.
 * The sample size affects detection accuracy: a smaller sample size may reduce the probability of correct file type detection.
 */
export function fileTypeStream(
  webStream: AnyWebReadableStream<Uint8Array>,
  options?: StreamOptions,
): Promise<AnyWebReadableByteStreamWithFileType> {
  return new FileTypeParser(options).toDetectionStream(webStream, options);
}

export class FileTypeParser {
  protected buffer: Uint8Array = new Uint8Array(reasonableDetectionSizeInBytes);
  protected tokenizer: strtok3.ITokenizer | undefined;
  protected readonly options: Omit<FileTypeOptions, "mpegOffsetTolerance"> & {
    mpegOffsetTolerance: number;
  };
  protected readonly detectors: Detector[];
  protected readonly tokenizerOptions: strtok3.ITokenizerOptions;

  constructor(
    options?: FileTypeOptions & StreamOptions & { signal?: AbortSignal },
  ) {
    this.options = {
      mpegOffsetTolerance: options?.mpegOffsetTolerance ?? 0,
      customDetectors: options?.customDetectors,
    };

    this.detectors = [
      ...(options?.customDetectors ?? []),
      { id: "core", detect: this.detectConfident.bind(this) },
      { id: "core.imprecise", detect: this.detectImprecise.bind(this) },
    ];
    this.tokenizerOptions = {
      abortSignal: options?.signal,
    };
  }

  /**
   * Works the same way as {@link fileTypeFromTokenizer}, additionally taking into account custom detectors (if any were provided to the constructor).
   */
  async fromTokenizer(
    tokenizer: strtok3.ITokenizer,
  ): Promise<FileTypeResult | undefined> {
    const initialPosition = tokenizer.position;

    // Iterate through all file-type detectors
    for (const detector of this.detectors) {
      const fileType = await detector.detect(tokenizer);
      if (fileType) {
        return fileType;
      }

      if (initialPosition !== tokenizer.position) {
        return undefined; // Cannot proceed scanning of the tokenizer is at an arbitrary position
      }
    }

    return undefined;
  }

  /**
   * Works the same way as {@link fileTypeFromBuffer}, additionally taking into account custom detectors (if any were provided to the constructor).
   */
  async fromBuffer(
    input: Uint8Array | ArrayBuffer,
  ): Promise<FileTypeResult | undefined> {
    if (!(input instanceof Uint8Array || input instanceof ArrayBuffer)) {
      throw new TypeError(
        `Expected the \`input\` argument to be of type \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof input}\``,
      );
    }

    const buffer = input instanceof Uint8Array ? input : new Uint8Array(input);

    if (!(buffer.length > 1)) {
      return undefined;
    }

    return this.fromTokenizer(
      strtok3.fromBuffer(buffer, this.tokenizerOptions),
    );
  }

  /**
   * Works the same way as {@link fileTypeFromBlob}, additionally taking into account custom detectors (if any were provided to the constructor).
   */
  fromBlob(blob: Blob): Promise<FileTypeResult | undefined> {
    return this.fromStream(blob.stream());
  }

  async fromStream(
    stream: AnyWebReadableStream<Uint8Array>,
  ): Promise<FileTypeResult | undefined> {
    const tokenizer = strtok3.fromWebStream(stream, this.tokenizerOptions);
    try {
      return await this.fromTokenizer(tokenizer);
    } finally {
      await tokenizer.close();
    }
  }

  /**
   * Works the same way as {@link fileTypeStream}, additionally taking into account custom detectors (if any were provided to the constructor).
   */
  async toDetectionStream(
    stream: AnyWebReadableStream<Uint8Array>,
    options: StreamOptions = {},
  ): Promise<AnyWebReadableByteStreamWithFileType> {
    const { sampleSize = reasonableDetectionSizeInBytes } = options;
    let detectedFileType: FileTypeResult | undefined;
    let firstChunk: Uint8Array | undefined;

    const reader = stream.getReader({ mode: "byob" });
    try {
      // Read the first chunk from the stream
      const { value: chunk, done } = await reader.read(
        new Uint8Array(sampleSize),
      );
      firstChunk = chunk;
      if (!done && chunk) {
        try {
          // Attempt to detect the file type from the chunk
          detectedFileType = await this.fromBuffer(
            chunk.subarray(0, sampleSize),
          );
        } catch (error) {
          if (!(error instanceof strtok3.EndOfStreamError)) {
            throw error; // Re-throw non-EndOfStreamError
          }

          detectedFileType = undefined;
        }
      }

      firstChunk = chunk;
    } finally {
      reader.releaseLock(); // Ensure the reader is released
    }

    // Create a new ReadableStream to manage locking issues
    const transformStream = new TransformStream({
      async start(controller) {
        controller.enqueue(firstChunk); // Enqueue the initial chunk
      },
      transform(chunk, controller) {
        // Pass through the chunks without modification
        controller.enqueue(chunk);
      },
    });

    const newStream = stream.pipeThrough(
      transformStream as never,
    ) as AnyWebReadableByteStreamWithFileType;
    newStream.fileType = detectedFileType;

    return newStream;
  }

  check(header: number[], options?: { offset?: number; mask?: number[] }) {
    return _check(this.buffer, header, options);
  }

  checkString(
    header: string,
    options?: { offset?: number; mask?: number[]; encoding?: string },
  ) {
    return this.check(stringToBytes(header, options?.encoding), options);
  }

  // Detections with a high degree of certainty in identifying the correct file type
  async detectConfident(
    tokenizer: strtok3.ITokenizer,
  ): Promise<FileTypeResult | undefined> {
    this.buffer = new Uint8Array(reasonableDetectionSizeInBytes);

    // Keep reading until EOF if the file size is unknown.
    if (tokenizer.fileInfo.size === undefined) {
      tokenizer.fileInfo.size = Number.MAX_SAFE_INTEGER;
    }

    this.tokenizer = tokenizer;

    await tokenizer.peekBuffer(this.buffer, { length: 32, mayBeLess: true });

    // -- 2-byte signatures --

    if (this.check([0x42, 0x4d])) {
      return {
        ext: "bmp",
        mime: "image/bmp",
      };
    }

    if (this.check([0x0b, 0x77])) {
      return {
        ext: "ac3",
        mime: "audio/vnd.dolby.dd-raw",
      };
    }

    if (this.check([0x78, 0x01])) {
      return {
        ext: "dmg",
        mime: "application/x-apple-diskimage",
      };
    }

    if (this.check([0x4d, 0x5a])) {
      return {
        ext: "exe",
        mime: "application/x-msdownload",
      };
    }

    if (this.check([0x25, 0x21])) {
      await tokenizer.peekBuffer(this.buffer, { length: 24, mayBeLess: true });

      if (
        this.checkString("PS-Adobe-", { offset: 2 }) &&
        this.checkString(" EPSF-", { offset: 14 })
      ) {
        return {
          ext: "eps",
          mime: "application/eps",
        };
      }

      return {
        ext: "ps",
        mime: "application/postscript",
      };
    }

    if (this.check([0x1f, 0xa0]) || this.check([0x1f, 0x9d])) {
      return {
        ext: "Z",
        mime: "application/x-compress",
      };
    }

    if (this.check([0xc7, 0x71])) {
      return {
        ext: "cpio",
        mime: "application/x-cpio",
      };
    }

    if (this.check([0x60, 0xea])) {
      return {
        ext: "arj",
        mime: "application/x-arj",
      };
    }

    // -- 3-byte signatures --

    if (this.check([0xef, 0xbb, 0xbf])) {
      // UTF-8-BOM
      // Strip off UTF-8-BOM
      tokenizer.ignore(3);
      return this.detectConfident(tokenizer);
    }

    if (this.check([0x47, 0x49, 0x46])) {
      return {
        ext: "gif",
        mime: "image/gif",
      };
    }

    if (this.check([0x49, 0x49, 0xbc])) {
      return {
        ext: "jxr",
        mime: "image/vnd.ms-photo",
      };
    }

    if (this.check([0x1f, 0x8b, 0x8])) {
      const gzipHandler = new GzipHandler(tokenizer);

      const stream = gzipHandler.inflate();
      try {
        const compressedFileType = await this.fromStream(stream);
        if (compressedFileType && compressedFileType.ext === "tar") {
          return {
            ext: "tar.gz",
            mime: "application/gzip",
          };
        }
      } finally {
        await stream.cancel();
      }

      return {
        ext: "gz",
        mime: "application/gzip",
      };
    }

    if (this.check([0x42, 0x5a, 0x68])) {
      return {
        ext: "bz2",
        mime: "application/x-bzip2",
      };
    }

    if (this.checkString("ID3")) {
      await tokenizer.ignore(6); // Skip ID3 header until the header size
      const id3HeaderLength = await tokenizer.readToken(uint32SyncSafeToken);
      if (tokenizer.position + id3HeaderLength > tokenizer.fileInfo.size) {
        // Guess file type based on ID3 header for backward compatibility
        return {
          ext: "mp3",
          mime: "audio/mpeg",
        };
      }

      await tokenizer.ignore(id3HeaderLength);
      return this.fromTokenizer(tokenizer); // Skip ID3 header, recursion
    }

    // Musepack, SV7
    if (this.checkString("MP+")) {
      return {
        ext: "mpc",
        mime: "audio/x-musepack",
      };
    }

    if (
      (this.buffer[0] === 0x43 || this.buffer[0] === 0x46) &&
      this.check([0x57, 0x53], { offset: 1 })
    ) {
      return {
        ext: "swf",
        mime: "application/x-shockwave-flash",
      };
    }

    // -- 4-byte signatures --

    // Requires a sample size of 4 bytes
    if (this.check([0xff, 0xd8, 0xff])) {
      if (this.check([0xf7], { offset: 3 })) {
        // JPG7/SOF55, indicating a ISO/IEC 14495 / JPEG-LS file
        return {
          ext: "jls",
          mime: "image/jls",
        };
      }

      return {
        ext: "jpg",
        mime: "image/jpeg",
      };
    }

    if (this.check([0x4f, 0x62, 0x6a, 0x01])) {
      return {
        ext: "avro",
        mime: "application/avro",
      };
    }

    if (this.checkString("FLIF")) {
      return {
        ext: "flif",
        mime: "image/flif",
      };
    }

    if (this.checkString("8BPS")) {
      return {
        ext: "psd",
        mime: "image/vnd.adobe.photoshop",
      };
    }

    // Musepack, SV8
    if (this.checkString("MPCK")) {
      return {
        ext: "mpc",
        mime: "audio/x-musepack",
      };
    }

    if (this.checkString("FORM")) {
      return {
        ext: "aif",
        mime: "audio/aiff",
      };
    }

    if (this.checkString("icns", { offset: 0 })) {
      return {
        ext: "icns",
        mime: "image/icns",
      };
    }

    // Zip-based file formats
    // Need to be before the `zip` check
    if (this.check([0x50, 0x4b, 0x3, 0x4])) {
      // Local file header signature
      let fileType: FileTypeResult | undefined;
      await new ZipHandler(tokenizer).unzip(
        (zipHeader: {
          filename: string;
        }): {
          handler: ((fileData: Uint8Array) => Promise<void>) | false;
          stop?: boolean;
        } => {
          switch (zipHeader.filename) {
            case "META-INF/mozilla.rsa":
              fileType = {
                ext: "xpi",
                mime: "application/x-xpinstall",
              };
              return { handler: false, stop: true };
            case "META-INF/MANIFEST.MF":
              fileType = {
                ext: "jar",
                mime: "application/java-archive",
              };
              return { handler: false, stop: true };
            case "mimetype":
              return {
                async handler(fileData: Uint8Array) {
                  // Use TextDecoder to decode the UTF-8 encoded data
                  const mimeType = new TextDecoder("utf-8")
                    .decode(fileData)
                    .trim();
                  fileType = getFileTypeFromMimeType(mimeType);
                },
                stop: true,
              };

            case "[Content_Types].xml":
              return {
                async handler(fileData: Uint8Array) {
                  // Use TextDecoder to decode the UTF-8 encoded data
                  let xmlContent = new TextDecoder("utf-8").decode(fileData);
                  const endPos = xmlContent.indexOf('.main+xml"');
                  if (endPos === -1) {
                    const mimeType =
                      "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
                    if (xmlContent.includes(`ContentType="${mimeType}"`)) {
                      fileType = getFileTypeFromMimeType(mimeType);
                    }
                  } else {
                    xmlContent = xmlContent.slice(0, Math.max(0, endPos));
                    const firstPos = xmlContent.lastIndexOf('"');
                    const mimeType = xmlContent.slice(
                      Math.max(0, firstPos + 1),
                    );
                    fileType = getFileTypeFromMimeType(mimeType);
                  }
                },
                stop: true,
              };
            default:
              if (/classes\d*\.dex/.test(zipHeader.filename)) {
                fileType = {
                  ext: "apk",
                  mime: "application/vnd.android.package-archive",
                };
                return { handler: false, stop: true };
              }

              return { handler: false, stop: false };
          }
        },
      );

      return (
        fileType ?? {
          ext: "zip",
          mime: "application/zip",
        }
      );
    }

    if (this.checkString("OggS")) {
      // This is an OGG container
      await tokenizer.ignore(28);
      const type = new Uint8Array(8);
      await tokenizer.readBuffer(type);

      // Needs to be before `ogg` check
      if (_check(type, [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64])) {
        return {
          ext: "opus",
          mime: "audio/ogg; codecs=opus",
        };
      }

      // If ' theora' in header.
      if (_check(type, [0x80, 0x74, 0x68, 0x65, 0x6f, 0x72, 0x61])) {
        return {
          ext: "ogv",
          mime: "video/ogg",
        };
      }

      // If '\x01video' in header.
      if (_check(type, [0x01, 0x76, 0x69, 0x64, 0x65, 0x6f, 0x00])) {
        return {
          ext: "ogm",
          mime: "video/ogg",
        };
      }

      // If ' FLAC' in header  https://xiph.org/flac/faq.html
      if (_check(type, [0x7f, 0x46, 0x4c, 0x41, 0x43])) {
        return {
          ext: "oga",
          mime: "audio/ogg",
        };
      }

      // 'Speex  ' in header https://en.wikipedia.org/wiki/Speex
      if (_check(type, [0x53, 0x70, 0x65, 0x65, 0x78, 0x20, 0x20])) {
        return {
          ext: "spx",
          mime: "audio/ogg",
        };
      }

      // If '\x01vorbis' in header
      if (_check(type, [0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])) {
        return {
          ext: "ogg",
          mime: "audio/ogg",
        };
      }

      // Default OGG container https://www.iana.org/assignments/media-types/application/ogg
      return {
        ext: "ogx",
        mime: "application/ogg",
      };
    }

    if (
      this.check([0x50, 0x4b]) &&
      (this.buffer[2] === 0x3 ||
        this.buffer[2] === 0x5 ||
        this.buffer[2] === 0x7) &&
      (this.buffer[3] === 0x4 ||
        this.buffer[3] === 0x6 ||
        this.buffer[3] === 0x8)
    ) {
      return {
        ext: "zip",
        mime: "application/zip",
      };
    }

    if (this.checkString("MThd")) {
      return {
        ext: "mid",
        mime: "audio/midi",
      };
    }

    if (
      this.checkString("wOFF") &&
      (this.check([0x00, 0x01, 0x00, 0x00], { offset: 4 }) ||
        this.checkString("OTTO", { offset: 4 }))
    ) {
      return {
        ext: "woff",
        mime: "font/woff",
      };
    }

    if (
      this.checkString("wOF2") &&
      (this.check([0x00, 0x01, 0x00, 0x00], { offset: 4 }) ||
        this.checkString("OTTO", { offset: 4 }))
    ) {
      return {
        ext: "woff2",
        mime: "font/woff2",
      };
    }

    if (
      this.check([0xd4, 0xc3, 0xb2, 0xa1]) ||
      this.check([0xa1, 0xb2, 0xc3, 0xd4])
    ) {
      return {
        ext: "pcap",
        mime: "application/vnd.tcpdump.pcap",
      };
    }

    // Sony DSD Stream File (DSF)
    if (this.checkString("DSD ")) {
      return {
        ext: "dsf",
        mime: "audio/x-dsf", // Non-standard
      };
    }

    if (this.checkString("LZIP")) {
      return {
        ext: "lz",
        mime: "application/x-lzip",
      };
    }

    if (this.checkString("fLaC")) {
      return {
        ext: "flac",
        mime: "audio/flac",
      };
    }

    if (this.check([0x42, 0x50, 0x47, 0xfb])) {
      return {
        ext: "bpg",
        mime: "image/bpg",
      };
    }

    if (this.checkString("wvpk")) {
      return {
        ext: "wv",
        mime: "audio/wavpack",
      };
    }

    if (this.checkString("%PDF")) {
      // Assume this is just a normal PDF
      return {
        ext: "pdf",
        mime: "application/pdf",
      };
    }

    if (this.check([0x00, 0x61, 0x73, 0x6d])) {
      return {
        ext: "wasm",
        mime: "application/wasm",
      };
    }

    // TIFF, little-endian type
    if (this.check([0x49, 0x49])) {
      const fileType = await this.readTiffHeader(false);
      if (fileType) {
        return fileType;
      }
    }

    // TIFF, big-endian type
    if (this.check([0x4d, 0x4d])) {
      const fileType = await this.readTiffHeader(true);
      if (fileType) {
        return fileType;
      }
    }

    if (this.checkString("MAC ")) {
      return {
        ext: "ape",
        mime: "audio/ape",
      };
    }

    // https://github.com/file/file/blob/master/magic/Magdir/matroska
    if (this.check([0x1a, 0x45, 0xdf, 0xa3])) {
      // Root element: EBML
      async function readField() {
        const msb = await tokenizer.peekNumber(Token.UINT8);
        let mask = 0x80;
        let ic = 0; // 0 = A, 1 = B, 2 = C, 3 = D

        while ((msb & mask) === 0 && mask !== 0) {
          ++ic;
          mask >>= 1;
        }

        const id = new Uint8Array(ic + 1);
        await tokenizer.readBuffer(id);
        return id;
      }

      async function readElement() {
        const idField = await readField();
        const lengthField = await readField();

        lengthField[0] ??= 0;
        lengthField[0] ^= 0x80 >> (lengthField.length - 1);
        const nrLength = Math.min(6, lengthField.length); // JavaScript can max read 6 bytes integer

        const idView = new DataView(idField.buffer);
        const lengthView = new DataView(
          lengthField.buffer,
          lengthField.length - nrLength,
          nrLength,
        );

        return {
          id: getUintBE(idView),
          len: getUintBE(lengthView),
        };
      }

      async function readChildren(
        children: number,
      ): Promise<string | undefined> {
        while (children > 0) {
          const element = await readElement();
          if (element.id === 0x42_82) {
            const rawValue = await tokenizer.readToken(
              new Token.StringType(element.len, "utf8"),
            );
            return rawValue.replaceAll(/\x00.*$/g, ""); // Return DocType
          }

          await tokenizer.ignore(element.len); // ignore payload
          --children;
        }

        return undefined;
      }

      const re = await readElement();
      const documentType = await readChildren(re.len);

      switch (documentType) {
        case "webm":
          return {
            ext: "webm",
            mime: "video/webm",
          };

        case "matroska":
          return {
            ext: "mkv",
            mime: "video/matroska",
          };

        default:
          return;
      }
    }

    if (this.checkString("SQLi")) {
      return {
        ext: "sqlite",
        mime: "application/x-sqlite3",
      };
    }

    if (this.check([0x4e, 0x45, 0x53, 0x1a])) {
      return {
        ext: "nes",
        mime: "application/x-nintendo-nes-rom",
      };
    }

    if (this.checkString("Cr24")) {
      return {
        ext: "crx",
        mime: "application/x-google-chrome-extension",
      };
    }

    if (this.checkString("MSCF") || this.checkString("ISc(")) {
      return {
        ext: "cab",
        mime: "application/vnd.ms-cab-compressed",
      };
    }

    if (this.check([0xed, 0xab, 0xee, 0xdb])) {
      return {
        ext: "rpm",
        mime: "application/x-rpm",
      };
    }

    if (this.check([0xc5, 0xd0, 0xd3, 0xc6])) {
      return {
        ext: "eps",
        mime: "application/eps",
      };
    }

    if (this.check([0x28, 0xb5, 0x2f, 0xfd])) {
      return {
        ext: "zst",
        mime: "application/zstd",
      };
    }

    if (this.check([0x7f, 0x45, 0x4c, 0x46])) {
      return {
        ext: "elf",
        mime: "application/x-elf",
      };
    }

    if (this.check([0x21, 0x42, 0x44, 0x4e])) {
      return {
        ext: "pst",
        mime: "application/vnd.ms-outlook",
      };
    }

    if (this.checkString("PAR1") || this.checkString("PARE")) {
      return {
        ext: "parquet",
        mime: "application/vnd.apache.parquet",
      };
    }

    if (this.checkString("ttcf")) {
      return {
        ext: "ttc",
        mime: "font/collection",
      };
    }

    if (this.check([0xcf, 0xfa, 0xed, 0xfe])) {
      return {
        ext: "macho",
        mime: "application/x-mach-binary",
      };
    }

    if (this.check([0x04, 0x22, 0x4d, 0x18])) {
      return {
        ext: "lz4",
        mime: "application/x-lz4", // Invented by us
      };
    }

    if (this.checkString("regf")) {
      return {
        ext: "dat",
        mime: "application/x-ft-windows-registry-hive",
      };
    }

    // -- 5-byte signatures --

    if (this.check([0x4f, 0x54, 0x54, 0x4f, 0x00])) {
      return {
        ext: "otf",
        mime: "font/otf",
      };
    }

    if (this.checkString("#!AMR")) {
      return {
        ext: "amr",
        mime: "audio/amr",
      };
    }

    if (this.checkString("{\\rtf")) {
      return {
        ext: "rtf",
        mime: "application/rtf",
      };
    }

    if (this.check([0x46, 0x4c, 0x56, 0x01])) {
      return {
        ext: "flv",
        mime: "video/x-flv",
      };
    }

    if (this.checkString("IMPM")) {
      return {
        ext: "it",
        mime: "audio/x-it",
      };
    }

    if (
      this.checkString("-lh0-", { offset: 2 }) ||
      this.checkString("-lh1-", { offset: 2 }) ||
      this.checkString("-lh2-", { offset: 2 }) ||
      this.checkString("-lh3-", { offset: 2 }) ||
      this.checkString("-lh4-", { offset: 2 }) ||
      this.checkString("-lh5-", { offset: 2 }) ||
      this.checkString("-lh6-", { offset: 2 }) ||
      this.checkString("-lh7-", { offset: 2 }) ||
      this.checkString("-lzs-", { offset: 2 }) ||
      this.checkString("-lz4-", { offset: 2 }) ||
      this.checkString("-lz5-", { offset: 2 }) ||
      this.checkString("-lhd-", { offset: 2 })
    ) {
      return {
        ext: "lzh",
        mime: "application/x-lzh-compressed",
      };
    }

    // MPEG program stream (PS or MPEG-PS)
    if (this.check([0x00, 0x00, 0x01, 0xba])) {
      //  MPEG-PS, MPEG-1 Part 1
      if (this.check([0x21], { offset: 4, mask: [0xf1] })) {
        return {
          ext: "mpg", // May also be .ps, .mpeg
          mime: "video/MP1S",
        };
      }

      // MPEG-PS, MPEG-2 Part 1
      if (this.check([0x44], { offset: 4, mask: [0xc4] })) {
        return {
          ext: "mpg", // May also be .mpg, .m2p, .vob or .sub
          mime: "video/MP2P",
        };
      }
    }

    if (this.checkString("ITSF")) {
      return {
        ext: "chm",
        mime: "application/vnd.ms-htmlhelp",
      };
    }

    if (this.check([0xca, 0xfe, 0xba, 0xbe])) {
      return {
        ext: "class",
        mime: "application/java-vm",
      };
    }

    if (this.checkString(".RMF")) {
      return {
        ext: "rm",
        mime: "application/vnd.rn-realmedia",
      };
    }

    // -- 5-byte signatures --

    if (this.checkString("DRACO")) {
      return {
        ext: "drc",
        mime: "application/vnd.google.draco", // Invented by us
      };
    }

    // -- 6-byte signatures --

    if (this.check([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) {
      return {
        ext: "xz",
        mime: "application/x-xz",
      };
    }

    if (this.checkString("<?xml ")) {
      return {
        ext: "xml",
        mime: "application/xml",
      };
    }

    if (this.check([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
      return {
        ext: "7z",
        mime: "application/x-7z-compressed",
      };
    }

    if (
      this.check([0x52, 0x61, 0x72, 0x21, 0x1a, 0x7]) &&
      (this.buffer[6] === 0x0 || this.buffer[6] === 0x1)
    ) {
      return {
        ext: "rar",
        mime: "application/x-rar-compressed",
      };
    }

    if (this.checkString("solid ")) {
      return {
        ext: "stl",
        mime: "model/stl",
      };
    }

    if (this.checkString("AC")) {
      const version = new Token.StringType(4, "latin1").get(this.buffer, 2);
      if (
        version.match("^d*") &&
        Number(version) >= 1000 &&
        Number(version) <= 1050
      ) {
        return {
          ext: "dwg",
          mime: "image/vnd.dwg",
        };
      }
    }

    if (this.checkString("070707")) {
      return {
        ext: "cpio",
        mime: "application/x-cpio",
      };
    }

    // -- 7-byte signatures --

    if (this.checkString("BLENDER")) {
      return {
        ext: "blend",
        mime: "application/x-blender",
      };
    }

    if (this.checkString("!<arch>")) {
      await tokenizer.ignore(8);
      const string = await tokenizer.readToken(
        new Token.StringType(13, "ascii"),
      );
      if (string === "debian-binary") {
        return {
          ext: "deb",
          mime: "application/x-deb",
        };
      }

      return {
        ext: "ar",
        mime: "application/x-unix-archive",
      };
    }

    if (
      this.checkString("WEBVTT") &&
      // One of LF, CR, tab, space, or end of file must follow "WEBVTT" per the spec (see `fixture/fixture-vtt-*.vtt` for examples). Note that `\0` is technically the null character (there is no such thing as an EOF character). However, checking for `\0` gives us the same result as checking for the end of the stream.
      ["\n", "\r", "\t", " ", "\0"].some((char7) =>
        this.checkString(char7, { offset: 6 }),
      )
    ) {
      return {
        ext: "vtt",
        mime: "text/vtt",
      };
    }

    // -- 8-byte signatures --

    if (this.check([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      // APNG format (https://wiki.mozilla.org/APNG_Specification)
      // 1. Find the first IDAT (image data) chunk (49 44 41 54)
      // 2. Check if there is an "acTL" chunk before the IDAT one (61 63 54 4C)

      // Offset calculated as follows:
      // - 8 bytes: PNG signature
      // - 4 (length) + 4 (chunk type) + 13 (chunk data) + 4 (CRC): IHDR chunk

      await tokenizer.ignore(8); // ignore PNG signature

      async function readChunkHeader() {
        return {
          length: await tokenizer.readToken(Token.INT32_BE),
          type: await tokenizer.readToken(new Token.StringType(4, "latin1")),
        };
      }

      do {
        const chunk = await readChunkHeader();
        if (chunk.length < 0) {
          return; // Invalid chunk length
        }

        switch (chunk.type) {
          case "IDAT":
            return {
              ext: "png",
              mime: "image/png",
            };
          case "acTL":
            return {
              ext: "apng",
              mime: "image/apng",
            };
          default:
            await tokenizer.ignore(chunk.length + 4); // Ignore chunk-data + CRC
        }
      } while (tokenizer.position + 8 < tokenizer.fileInfo.size);

      return {
        ext: "png",
        mime: "image/png",
      };
    }

    if (this.check([0x41, 0x52, 0x52, 0x4f, 0x57, 0x31, 0x00, 0x00])) {
      return {
        ext: "arrow",
        mime: "application/vnd.apache.arrow.file",
      };
    }

    if (this.check([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00])) {
      return {
        ext: "glb",
        mime: "model/gltf-binary",
      };
    }

    // `mov` format variants
    if (
      this.check([0x66, 0x72, 0x65, 0x65], { offset: 4 }) || // `free`
      this.check([0x6d, 0x64, 0x61, 0x74], { offset: 4 }) || // `mdat` MJPEG
      this.check([0x6d, 0x6f, 0x6f, 0x76], { offset: 4 }) || // `moov`
      this.check([0x77, 0x69, 0x64, 0x65], { offset: 4 }) // `wide`
    ) {
      return {
        ext: "mov",
        mime: "video/quicktime",
      };
    }

    // -- 9-byte signatures --

    if (this.check([0x49, 0x49, 0x52, 0x4f, 0x08, 0x00, 0x00, 0x00, 0x18])) {
      return {
        ext: "orf",
        mime: "image/x-olympus-orf",
      };
    }

    if (this.checkString("gimp xcf ")) {
      return {
        ext: "xcf",
        mime: "image/x-xcf",
      };
    }

    // File Type Box (https://en.wikipedia.org/wiki/ISO_base_media_file_format)
    // It's not required to be first, but it's recommended to be. Almost all ISO base media files start with `ftyp` box.
    // `ftyp` box must contain a brand major identifier, which must consist of ISO 8859-1 printable characters.
    // Here we check for 8859-1 printable characters (for simplicity, it's a mask which also catches one non-printable character).
    if (
      this.checkString("ftyp", { offset: 4 }) &&
      ((this.buffer[8] ?? 0) & 0x60) !== 0x00 // Brand major, first character ASCII?
    ) {
      // They all can have MIME `video/mp4` except `application/mp4` special-case which is hard to detect.
      // For some cases, we're specific, everything else falls to `video/mp4` with `mp4` extension.
      const brandMajor = new Token.StringType(4, "latin1")
        .get(this.buffer, 8)
        .replace("\0", " ")
        .trim();
      switch (brandMajor) {
        case "avif":
        case "avis":
          return { ext: "avif", mime: "image/avif" };
        case "mif1":
          return { ext: "heic", mime: "image/heif" };
        case "msf1":
          return { ext: "heic", mime: "image/heif-sequence" };
        case "heic":
        case "heix":
          return { ext: "heic", mime: "image/heic" };
        case "hevc":
        case "hevx":
          return { ext: "heic", mime: "image/heic-sequence" };
        case "qt":
          return { ext: "mov", mime: "video/quicktime" };
        case "M4V":
        case "M4VH":
        case "M4VP":
          return { ext: "m4v", mime: "video/x-m4v" };
        case "M4P":
          return { ext: "m4p", mime: "video/mp4" };
        case "M4B":
          return { ext: "m4b", mime: "audio/mp4" };
        case "M4A":
          return { ext: "m4a", mime: "audio/x-m4a" };
        case "F4V":
          return { ext: "f4v", mime: "video/mp4" };
        case "F4P":
          return { ext: "f4p", mime: "video/mp4" };
        case "F4A":
          return { ext: "f4a", mime: "audio/mp4" };
        case "F4B":
          return { ext: "f4b", mime: "audio/mp4" };
        case "crx":
          return { ext: "cr3", mime: "image/x-canon-cr3" };
        default:
          if (brandMajor.startsWith("3g")) {
            if (brandMajor.startsWith("3g2")) {
              return { ext: "3g2", mime: "video/3gpp2" };
            }

            return { ext: "3gp", mime: "video/3gpp" };
          }

          return { ext: "mp4", mime: "video/mp4" };
      }
    }

    // -- 10-byte signatures --

    if (this.checkString("REGEDIT4\r\n")) {
      return {
        ext: "reg",
        mime: "application/x-ms-regedit",
      };
    }

    // -- 12-byte signatures --

    // RIFF file format which might be AVI, WAV, QCP, etc
    if (this.check([0x52, 0x49, 0x46, 0x46])) {
      if (this.checkString("WEBP", { offset: 8 })) {
        return {
          ext: "webp",
          mime: "image/webp",
        };
      }

      if (this.check([0x41, 0x56, 0x49], { offset: 8 })) {
        return {
          ext: "avi",
          mime: "video/vnd.avi",
        };
      }

      if (this.check([0x57, 0x41, 0x56, 0x45], { offset: 8 })) {
        return {
          ext: "wav",
          mime: "audio/wav",
        };
      }

      // QLCM, QCP file
      if (this.check([0x51, 0x4c, 0x43, 0x4d], { offset: 8 })) {
        return {
          ext: "qcp",
          mime: "audio/qcelp",
        };
      }
    }

    if (
      this.check([
        0x49, 0x49, 0x55, 0x00, 0x18, 0x00, 0x00, 0x00, 0x88, 0xe7, 0x74, 0xd8,
      ])
    ) {
      return {
        ext: "rw2",
        mime: "image/x-panasonic-rw2",
      };
    }

    // ASF_Header_Object first 80 bytes
    if (
      this.check([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9])
    ) {
      async function readHeader() {
        const guid = new Uint8Array(16);
        await tokenizer.readBuffer(guid);
        return {
          id: guid,
          size: Number(await tokenizer.readToken(Token.UINT64_LE)),
        };
      }

      await tokenizer.ignore(30);
      // Search for header should be in first 1KB of file.
      while (tokenizer.position + 24 < tokenizer.fileInfo.size) {
        const header = await readHeader();
        let payload = header.size - 24;
        if (
          _check(
            header.id,
            [
              0x91, 0x07, 0xdc, 0xb7, 0xb7, 0xa9, 0xcf, 0x11, 0x8e, 0xe6, 0x00,
              0xc0, 0x0c, 0x20, 0x53, 0x65,
            ],
          )
        ) {
          // Sync on Stream-Properties-Object (B7DC0791-A9B7-11CF-8EE6-00C00C205365)
          const typeId = new Uint8Array(16);
          payload -= await tokenizer.readBuffer(typeId);

          if (
            _check(
              typeId,
              [
                0x40, 0x9e, 0x69, 0xf8, 0x4d, 0x5b, 0xcf, 0x11, 0xa8, 0xfd,
                0x00, 0x80, 0x5f, 0x5c, 0x44, 0x2b,
              ],
            )
          ) {
            // Found audio:
            return {
              ext: "asf",
              mime: "audio/x-ms-asf",
            };
          }

          if (
            _check(
              typeId,
              [
                0xc0, 0xef, 0x19, 0xbc, 0x4d, 0x5b, 0xcf, 0x11, 0xa8, 0xfd,
                0x00, 0x80, 0x5f, 0x5c, 0x44, 0x2b,
              ],
            )
          ) {
            // Found video:
            return {
              ext: "asf",
              mime: "video/x-ms-asf",
            };
          }

          break;
        }

        await tokenizer.ignore(payload);
      }

      // Default to ASF generic extension
      return {
        ext: "asf",
        mime: "application/vnd.ms-asf",
      };
    }

    if (
      this.check([
        0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
      ])
    ) {
      return {
        ext: "ktx",
        mime: "image/ktx",
      };
    }

    if (
      (this.check([0x7e, 0x10, 0x04]) || this.check([0x7e, 0x18, 0x04])) &&
      this.check([0x30, 0x4d, 0x49, 0x45], { offset: 4 })
    ) {
      return {
        ext: "mie",
        mime: "application/x-mie",
      };
    }

    if (
      this.check(
        [
          0x27, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00,
        ],
        { offset: 2 },
      )
    ) {
      return {
        ext: "shp",
        mime: "application/x-esri-shape",
      };
    }

    if (this.check([0xff, 0x4f, 0xff, 0x51])) {
      return {
        ext: "j2c",
        mime: "image/j2c",
      };
    }

    if (
      this.check([
        0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
      ])
    ) {
      // JPEG-2000 family

      await tokenizer.ignore(20);
      const type = await tokenizer.readToken(new Token.StringType(4, "ascii"));
      switch (type) {
        case "jp2 ":
          return {
            ext: "jp2",
            mime: "image/jp2",
          };
        case "jpx ":
          return {
            ext: "jpx",
            mime: "image/jpx",
          };
        case "jpm ":
          return {
            ext: "jpm",
            mime: "image/jpm",
          };
        case "mjp2":
          return {
            ext: "mj2",
            mime: "image/mj2",
          };
        default:
          return;
      }
    }

    if (
      this.check([0xff, 0x0a]) ||
      this.check([
        0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
      ])
    ) {
      return {
        ext: "jxl",
        mime: "image/jxl",
      };
    }

    if (this.check([0xfe, 0xff])) {
      // UTF-16-BOM-BE
      if (this.checkString("<?xml ", { offset: 2, encoding: "utf-16be" })) {
        return {
          ext: "xml",
          mime: "application/xml",
        };
      }

      return undefined; // Some unknown text based format
    }

    if (this.check([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
      // Detected Microsoft Compound File Binary File (MS-CFB) Format.
      return {
        ext: "cfb",
        mime: "application/x-cfb",
      };
    }

    // Increase sample size from 32 to 256.
    await tokenizer.peekBuffer(this.buffer, {
      length: Math.min(256, tokenizer.fileInfo.size),
      mayBeLess: true,
    });

    if (this.check([0x61, 0x63, 0x73, 0x70], { offset: 36 })) {
      return {
        ext: "icc",
        mime: "application/vnd.iccprofile",
      };
    }

    // ACE: requires 14 bytes in the buffer
    if (
      this.checkString("**ACE", { offset: 7 }) &&
      this.checkString("**", { offset: 12 })
    ) {
      return {
        ext: "ace",
        mime: "application/x-ace-compressed",
      };
    }

    // -- 15-byte signatures --

    if (this.checkString("BEGIN:")) {
      if (this.checkString("VCARD", { offset: 6 })) {
        return {
          ext: "vcf",
          mime: "text/vcard",
        };
      }

      if (this.checkString("VCALENDAR", { offset: 6 })) {
        return {
          ext: "ics",
          mime: "text/calendar",
        };
      }
    }

    // `raf` is here just to keep all the raw image detectors together.
    if (this.checkString("FUJIFILMCCD-RAW")) {
      return {
        ext: "raf",
        mime: "image/x-fujifilm-raf",
      };
    }

    if (this.checkString("Extended Module:")) {
      return {
        ext: "xm",
        mime: "audio/x-xm",
      };
    }

    if (this.checkString("Creative Voice File")) {
      return {
        ext: "voc",
        mime: "audio/x-voc",
      };
    }

    if (this.check([0x04, 0x00, 0x00, 0x00]) && this.buffer.length >= 16) {
      // Rough & quick check Pickle/ASAR
      const jsonSize = new DataView(this.buffer.buffer).getUint32(12, true);

      if (jsonSize > 12 && this.buffer.length >= jsonSize + 16) {
        try {
          const header = new TextDecoder().decode(
            this.buffer.subarray(16, jsonSize + 16),
          );
          const json = JSON.parse(header);
          // Check if Pickle is ASAR
          if (json.files) {
            // Final check, assuring Pickle/ASAR format
            return {
              ext: "asar",
              mime: "application/x-asar",
            };
          }
        } catch {}
      }
    }

    if (
      this.check([
        0x06, 0x0e, 0x2b, 0x34, 0x02, 0x05, 0x01, 0x01, 0x0d, 0x01, 0x02, 0x01,
        0x01, 0x02,
      ])
    ) {
      return {
        ext: "mxf",
        mime: "application/mxf",
      };
    }

    if (this.checkString("SCRM", { offset: 44 })) {
      return {
        ext: "s3m",
        mime: "audio/x-s3m",
      };
    }

    // Raw MPEG-2 transport stream (188-byte packets)
    if (this.check([0x47]) && this.check([0x47], { offset: 188 })) {
      return {
        ext: "mts",
        mime: "video/mp2t",
      };
    }

    // Blu-ray Disc Audio-Video (BDAV) MPEG-2 transport stream has 4-byte TP_extra_header before each 188-byte packet
    if (
      this.check([0x47], { offset: 4 }) &&
      this.check([0x47], { offset: 196 })
    ) {
      return {
        ext: "mts",
        mime: "video/mp2t",
      };
    }

    if (
      this.check([0x42, 0x4f, 0x4f, 0x4b, 0x4d, 0x4f, 0x42, 0x49], {
        offset: 60,
      })
    ) {
      return {
        ext: "mobi",
        mime: "application/x-mobipocket-ebook",
      };
    }

    if (this.check([0x44, 0x49, 0x43, 0x4d], { offset: 128 })) {
      return {
        ext: "dcm",
        mime: "application/dicom",
      };
    }

    if (
      this.check([
        0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
        0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
      ])
    ) {
      return {
        ext: "lnk",
        mime: "application/x.ms.shortcut", // Invented by us
      };
    }

    if (
      this.check([
        0x62, 0x6f, 0x6f, 0x6b, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x61, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x00,
      ])
    ) {
      return {
        ext: "alias",
        mime: "application/x.apple.alias", // Invented by us
      };
    }

    if (this.checkString("Kaydara FBX Binary  \u0000")) {
      return {
        ext: "fbx",
        mime: "application/x.autodesk.fbx", // Invented by us
      };
    }

    if (
      this.check([0x4c, 0x50], { offset: 34 }) &&
      (this.check([0x00, 0x00, 0x01], { offset: 8 }) ||
        this.check([0x01, 0x00, 0x02], { offset: 8 }) ||
        this.check([0x02, 0x00, 0x02], { offset: 8 }))
    ) {
      return {
        ext: "eot",
        mime: "application/vnd.ms-fontobject",
      };
    }

    if (
      this.check([
        0x06, 0x06, 0xed, 0xf5, 0xd8, 0x1d, 0x46, 0xe5, 0xbd, 0x31, 0xef, 0xe7,
        0xfe, 0x74, 0xb7, 0x1d,
      ])
    ) {
      return {
        ext: "indd",
        mime: "application/x-indesign",
      };
    }

    // Increase sample size from 256 to 512
    await tokenizer.peekBuffer(this.buffer, {
      length: Math.min(512, tokenizer.fileInfo.size),
      mayBeLess: true,
    });

    // Requires a buffer size of 512 bytes
    if (
      (this.checkString("ustar", { offset: 257 }) &&
        (this.checkString("\0", { offset: 262 }) ||
          this.checkString(" ", { offset: 262 }))) ||
      (this.check([0, 0, 0, 0, 0, 0], { offset: 257 }) &&
        tarHeaderChecksumMatches(this.buffer))
    ) {
      return {
        ext: "tar",
        mime: "application/x-tar",
      };
    }

    if (this.check([0xff, 0xfe])) {
      // UTF-16-BOM-LE
      const encoding = "utf-16le";
      if (this.checkString("<?xml ", { offset: 2, encoding })) {
        return {
          ext: "xml",
          mime: "application/xml",
        };
      }

      if (
        this.check([0xff, 0x0e], { offset: 2 }) &&
        this.checkString("SketchUp Model", { offset: 4, encoding })
      ) {
        return {
          ext: "skp",
          mime: "application/vnd.sketchup.skp",
        };
      }

      if (
        this.checkString("Windows Registry Editor Version 5.00\r\n", {
          offset: 2,
          encoding,
        })
      ) {
        return {
          ext: "reg",
          mime: "application/x-ms-regedit",
        };
      }

      return undefined; // Some text based format
    }

    if (this.checkString("-----BEGIN PGP MESSAGE-----")) {
      return {
        ext: "pgp",
        mime: "application/pgp-encrypted",
      };
    }

    return undefined;
  }

  // Detections with limited supporting data, resulting in a higher likelihood of false positives
  async detectImprecise(
    tokenizer: strtok3.ITokenizer,
  ): Promise<FileTypeResult | undefined> {
    if (tokenizer.fileInfo.size === undefined) {
      tokenizer.fileInfo.size = Number.MAX_SAFE_INTEGER;
    }

    // Read initial sample size of 8 bytes
    await tokenizer.peekBuffer(this.buffer, {
      length: Math.min(8, tokenizer.fileInfo.size),
      mayBeLess: true,
    });

    if (
      this.check([0x0, 0x0, 0x1, 0xba]) ||
      this.check([0x0, 0x0, 0x1, 0xb3])
    ) {
      return {
        ext: "mpg",
        mime: "video/mpeg",
      };
    }

    if (this.check([0x00, 0x01, 0x00, 0x00, 0x00])) {
      return {
        ext: "ttf",
        mime: "font/ttf",
      };
    }

    if (this.check([0x00, 0x00, 0x01, 0x00])) {
      return {
        ext: "ico",
        mime: "image/x-icon",
      };
    }

    if (this.check([0x00, 0x00, 0x02, 0x00])) {
      return {
        ext: "cur",
        mime: "image/x-icon",
      };
    }

    // Adjust buffer to `mpegOffsetTolerance`
    await tokenizer.peekBuffer(this.buffer, {
      length: Math.min(
        2 + this.options.mpegOffsetTolerance,
        tokenizer.fileInfo.size,
      ),
      mayBeLess: true,
    });

    // Check MPEG 1 or 2 Layer 3 header, or 'layer 0' for ADTS (MPEG sync-word 0xFFE)
    if (this.buffer.length >= 2 + this.options.mpegOffsetTolerance) {
      for (let depth = 0; depth <= this.options.mpegOffsetTolerance; ++depth) {
        const type = this.scanMpeg(depth);
        if (type) {
          return type;
        }
      }
    }

    return undefined;
  }

  async readTiffTag(bigEndian: boolean): Promise<FileTypeResult | undefined> {
    const tagId = await this.tokenizer?.readToken(
      bigEndian ? Token.UINT16_BE : Token.UINT16_LE,
    );
    await this.tokenizer?.ignore(10);
    switch (tagId) {
      case 50_341:
        return {
          ext: "arw",
          mime: "image/x-sony-arw",
        };
      case 50_706:
        return {
          ext: "dng",
          mime: "image/x-adobe-dng",
        };
      default:
        return undefined;
    }
  }

  async readTiffIFD(bigEndian: boolean): Promise<FileTypeResult | undefined> {
    const numberOfTags = await this.tokenizer?.readToken(
      bigEndian ? Token.UINT16_BE : Token.UINT16_LE,
    );

    if (!numberOfTags) {
      return undefined;
    }

    for (let n = 0; n < numberOfTags; ++n) {
      const fileType = await this.readTiffTag(bigEndian);
      if (fileType) {
        return fileType;
      }
    }

    return undefined;
  }

  async readTiffHeader(
    bigEndian: boolean,
  ): Promise<FileTypeResult | undefined> {
    const version = (bigEndian ? Token.UINT16_BE : Token.UINT16_LE).get(
      this.buffer,
      2,
    );
    const ifdOffset = (bigEndian ? Token.UINT32_BE : Token.UINT32_LE).get(
      this.buffer,
      4,
    );

    if (version === 42) {
      // TIFF file header
      if (ifdOffset >= 6) {
        if (this.checkString("CR", { offset: 8 })) {
          return {
            ext: "cr2",
            mime: "image/x-canon-cr2",
          };
        }

        if (ifdOffset >= 8) {
          const someId1 = (bigEndian ? Token.UINT16_BE : Token.UINT16_LE).get(
            this.buffer,
            8,
          );
          const someId2 = (bigEndian ? Token.UINT16_BE : Token.UINT16_LE).get(
            this.buffer,
            10,
          );

          if (
            (someId1 === 0x1c && someId2 === 0xfe) ||
            (someId1 === 0x1f && someId2 === 0x0b)
          ) {
            return {
              ext: "nef",
              mime: "image/x-nikon-nef",
            };
          }
        }
      }

      await this.tokenizer?.ignore(ifdOffset);
      const fileType = await this.readTiffIFD(bigEndian);
      return (
        fileType ?? {
          ext: "tif",
          mime: "image/tiff",
        }
      );
    }

    if (version === 43) {
      // Big TIFF file header
      return {
        ext: "tif",
        mime: "image/tiff",
      };
    }

    return undefined;
  }

  /**
   * Scan for MPEG 1 or 2 Layer 3 header, or 'layer 0' for ADTS (MPEG sync-word 0xFFE).
   *
   * @param offset - Offset to scan for sync-preamble.
   * @returns The detected file type, or `undefined` if not found.
   */
  scanMpeg(offset: number): FileTypeResult | undefined {
    if (this.check([0xff, 0xe0], { offset, mask: [0xff, 0xe0] })) {
      if (this.check([0x10], { offset: offset + 1, mask: [0x16] })) {
        // Check for (ADTS) MPEG-2
        if (this.check([0x08], { offset: offset + 1, mask: [0x08] })) {
          return {
            ext: "aac",
            mime: "audio/aac",
          };
        }

        // Must be (ADTS) MPEG-4
        return {
          ext: "aac",
          mime: "audio/aac",
        };
      }

      // MPEG 1 or 2 Layer 3 header
      // Check for MPEG layer 3
      if (this.check([0x02], { offset: offset + 1, mask: [0x06] })) {
        return {
          ext: "mp3",
          mime: "audio/mpeg",
        };
      }

      // Check for MPEG layer 2
      if (this.check([0x04], { offset: offset + 1, mask: [0x06] })) {
        return {
          ext: "mp2",
          mime: "audio/mpeg",
        };
      }

      // Check for MPEG layer 1
      if (this.check([0x06], { offset: offset + 1, mask: [0x06] })) {
        return {
          ext: "mp1",
          mime: "audio/mpeg",
        };
      }
    }

    return undefined;
  }
}

export const supportedExtensions = new Set(extensions);
export const supportedMimeTypes = new Set(mimeTypes);
