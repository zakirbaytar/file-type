import type { Readable as NodeReadableStream } from "node:stream";
import { PassThrough, pipeline, Readable } from "node:stream";
import { ReadableStream as WebReadableStream } from "node:stream/web";
import * as strtok3 from "strtok3";
import {
	type FileTypeResult,
	type AnyWebReadableByteStreamWithFileType,
	type AnyWebReadableStream,
	FileTypeParser as DefaultFileTypeParser,
	type FileTypeOptions,
	reasonableDetectionSizeInBytes,
	type StreamOptions,
} from "./core";

export type ReadableStreamWithFileType = NodeReadableStream & {
	readonly fileType?: FileTypeResult;
};

function isWebReadableStream(
	stream: AnyWebReadableStream<Uint8Array> | NodeReadableStream,
): stream is AnyWebReadableStream<Uint8Array> {
	return stream instanceof WebReadableStream;
}

export class FileTypeParser extends DefaultFileTypeParser {
	/**
	 * @param stream - Node.js `stream.Readable` or web `ReadableStream`.
	 */
	async fromStream(
		stream: AnyWebReadableStream<Uint8Array> | NodeReadableStream,
	): Promise<FileTypeResult | undefined> {
		const tokenizer = await (isWebReadableStream(stream)
			? strtok3.fromWebStream(stream, this.tokenizerOptions)
			: strtok3.fromStream(stream, this.tokenizerOptions));

		try {
			return await super.fromTokenizer(tokenizer);
		} finally {
			await tokenizer.close();
		}
	}

	async fromFile(filePath: string): Promise<FileTypeResult | undefined> {
		const tokenizer = await strtok3.fromFile(filePath);
		try {
			return await super.fromTokenizer(tokenizer);
		} finally {
			await tokenizer.close();
		}
	}

	/**
	 * Works the same way as {@link fileTypeStream}, additionally taking into account custom detectors (if any were provided to the constructor).
	 */
	toDetectionStream(
		readableStream: NodeReadableStream,
		options?: FileTypeOptions & StreamOptions,
	): Promise<ReadableStreamWithFileType>;
	toDetectionStream(
		webStream: AnyWebReadableStream<Uint8Array>,
		options?: FileTypeOptions & StreamOptions,
	): Promise<AnyWebReadableByteStreamWithFileType>;
	async toDetectionStream(
		readableStream: AnyWebReadableStream<Uint8Array> | NodeReadableStream,
		options: FileTypeOptions & StreamOptions = {},
	) {
		if (!(readableStream instanceof Readable)) {
			return super.toDetectionStream(readableStream, options);
		}

		const { sampleSize = reasonableDetectionSizeInBytes } = options;

		return new Promise((resolve, reject) => {
			readableStream.on("error", reject);

			readableStream.once("readable", () => {
				(async () => {
					try {
						// Set up output stream
						const pass: PassThrough & { fileType?: FileTypeResult } =
							new PassThrough();
						const outputStream = pipeline
							? pipeline(readableStream, pass, () => {})
							: readableStream.pipe(pass);

						// Read the input stream and detect the filetype
						const chunk =
							readableStream.read(sampleSize) ??
							readableStream.read() ??
							new Uint8Array(0);
						try {
							pass.fileType = await this.fromBuffer(chunk);
						} catch (error) {
							if (error instanceof strtok3.EndOfStreamError) {
								pass.fileType = undefined;
							} else {
								reject(error);
							}
						}

						resolve(outputStream);
					} catch (error) {
						reject(error);
					}
				})();
			});
		});
	}
}

/**
 * Detect the file type of a file path.
 *
 * The file type is detected by checking the [magic number](https://en.wikipedia.org/wiki/Magic_number_(programming)#Magic_numbers_in_files) of the file.
 *
 * This is for Node.js only.
 *
 * To read from a [`File`](https://developer.mozilla.org/docs/Web/API/File), see `fileTypeFromBlob()`.
 *
 * @returns The detected file type and MIME type or `undefined` when there is no match.
 */
export function fileTypeFromFile(
	filePath: string,
	options?: FileTypeOptions & StreamOptions & strtok3.ITokenizerOptions,
): Promise<FileTypeResult | undefined> {
	return new FileTypeParser(options).fromFile(filePath);
}

/**
 * Detect the file type of a [web `ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream).
 *
 * If the engine is Node.js, this may also be a [Node.js `stream.Readable`](https://nodejs.org/api/stream.html#stream_class_stream_readable).
 *
 * Direct support for Node.js streams will be dropped in the future, when Node.js streams can be converted to Web streams (see [`toWeb()`](https://nodejs.org/api/stream.html#streamreadabletowebstreamreadable-options)).
 *
 * The file type is detected by checking the [magic number](https://en.wikipedia.org/wiki/Magic_number_(programming)#Magic_numbers_in_files) of the buffer.
 *
 * @param stream - A [web `ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) or [Node.js `stream.Readable`](https://nodejs.org/api/stream.html#stream_class_stream_readable) streaming a file to examine.
 * @param options - Options to override default behaviour.
 *
 * @returns A `Promise` for an object with the detected file type, or `undefined` when there is no match.
 */
export function fileTypeFromStream(
	stream: AnyWebReadableStream<Uint8Array> | NodeReadableStream,
	options?: FileTypeOptions & StreamOptions & strtok3.ITokenizerOptions,
): Promise<FileTypeResult | undefined> {
	return new FileTypeParser(options).fromStream(stream);
}

/**
 * Returns a `Promise` which resolves to the original readable stream argument, but with an added `fileType` property, which is an object like the one returned from `fileTypeFromFile()`.
 *
 * This method can be handy to put in between a stream, but it comes with a price.
 * Internally, `stream()` builds up a buffer of `sampleSize` bytes, used as a sample, to determine the file type.
 * The sample size impacts the file detection resolution.
 * A smaller sample size will result in lower probability of the best file type detection.
 *
 * @param readableStream - A [web `ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) or [Node.js `stream.Readable`](https://nodejs.org/api/stream.html#stream_class_stream_readable), streaming a file to examine.
 * @param options - May be used to override the default sample size.
 * @returns A `Promise` which resolves to the original readable stream argument, but with an added `fileType` property, which is an object like the one returned from `fileTypeFromFile()`.
 *
 * @example
 * ```typescript
 * import got from 'got';
 * import {fileTypeStream} from 'file-type';
 *
 * const url = 'https://upload.wikimedia.org/wikipedia/en/a/a9/Example.jpg';
 *
 * const stream1 = got.stream(url);
 * const stream2 = await fileTypeStream(stream1, {sampleSize: 1024});
 *
 * if (stream2.fileType?.mime === 'image/jpeg') {
 *   // stream2 can be used to stream the JPEG image (from the very beginning of the stream)
 * }
 * ```
 */
export function fileTypeStream(
	readableStream: NodeReadableStream,
	options?: FileTypeOptions & StreamOptions,
): Promise<ReadableStreamWithFileType>;
export function fileTypeStream(
	webStream: AnyWebReadableStream<Uint8Array>,
	options?: FileTypeOptions & StreamOptions,
): Promise<AnyWebReadableByteStreamWithFileType>;
export async function fileTypeStream(
	readableStream: AnyWebReadableStream<Uint8Array> | NodeReadableStream,
	options: FileTypeOptions & StreamOptions = {},
): Promise<ReadableStreamWithFileType | AnyWebReadableByteStreamWithFileType> {
	const parser = new FileTypeParser(options);
	if (isWebReadableStream(readableStream)) {
		return parser.toDetectionStream(readableStream, options);
	}

	return parser.toDetectionStream(readableStream, options);
}

export {
	type FileTypeResult,
	fileTypeFromBlob,
	fileTypeFromBuffer,
	fileTypeFromTokenizer,
	supportedExtensions,
	supportedMimeTypes,
} from "./core";
