import type { IGetToken } from "strtok3";
import { StringType } from "token-types";

export function stringToBytes(string: string, encoding?: string): number[] {
  if (encoding === "utf-16le") {
    const bytes: number[] = [];
    for (let index = 0; index < string.length; index++) {
      const code = string.charCodeAt(index);
      bytes.push(code & 0xff, (code >> 8) & 0xff); // High byte
    }

    return bytes;
  }

  if (encoding === "utf-16be") {
    const bytes: number[] = [];
    for (let index = 0; index < string.length; index++) {
      const code = string.charCodeAt(index);
      bytes.push((code >> 8) & 0xff, code & 0xff); // Low byte
    }

    return bytes;
  }

  return [...string].map((character) => character.charCodeAt(0));
}

/**
 * Checks whether the TAR checksum is valid.
 *
 * @param {Uint8Array} arrayBuffer - The TAR header `[offset ... offset + 512]`.
 * @param {number} offset - TAR header offset.
 * @returns {boolean} `true` if the TAR checksum is valid, otherwise `false`.
 */
export function tarHeaderChecksumMatches(
  arrayBuffer: Uint8Array,
  offset: number = 0,
): boolean {
  const readSum = Number.parseInt(
    new StringType(6, "utf8").get(arrayBuffer, 148).replace(/\0.*$/, "").trim(),
    8,
  ); // Read sum in header
  if (Number.isNaN(readSum)) {
    return false;
  }

  let sum = 8 * 0x20; // Initialize signed bit sum

  for (let index = offset; index < offset + 148; index++) {
    sum += arrayBuffer[index] ?? 0;
  }

  for (let index = offset + 156; index < offset + 512; index++) {
    sum += arrayBuffer[index] ?? 0;
  }

  return readSum === sum;
}

/**
 * ID3 UINT32 sync-safe tokenizer token.
 * 28 bits (representing up to 256MB) integer, the msb is 0 to avoid "false sync signals".
 */
export const uint32SyncSafeToken: IGetToken<number> = {
  get: (buffer, offset) =>
    ((buffer[offset + 3] ?? 0) & 0x7f) |
    ((buffer[offset + 2] ?? 0) << 7) |
    ((buffer[offset + 1] ?? 0) << 14) |
    ((buffer[offset] ?? 0) << 21),
  len: 4,
};
