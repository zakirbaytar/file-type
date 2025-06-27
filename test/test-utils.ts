import { getStreamAsArrayBuffer } from "get-stream";
import { join } from "node:path";
import type { Readable as NodeReadableStream } from "node:stream";
import { supportedExtensions } from "../src";
import type { AnyWebReadableStream } from "../src/core";

// Define an entry here only if the fixture has a different
// name than `fixture` or if you want multiple fixtures
const names: Record<string, string[]> = {
  aac: [
    "fixture-adts-mpeg2",
    "fixture-adts-mpeg4",
    "fixture-adts-mpeg4-2",
    "fixture-id3v2",
  ],
  asar: ["fixture", "fixture2"],
  arw: ["fixture-sony-zv-e10"],
  cr3: ["fixture"],
  dng: ["fixture-Leica-M10"],
  drc: ["fixture-cube_pc"],
  epub: ["fixture", "fixture-crlf"],
  nef: ["fixture", "fixture2", "fixture3", "fixture4"],
  "3gp": ["fixture", "fixture2"],
  woff2: ["fixture", "fixture-otto"],
  woff: ["fixture", "fixture-otto"],
  eot: ["fixture", "fixture-0x20001"],
  mov: ["fixture", "fixture-mjpeg", "fixture-moov"],
  mp2: ["fixture", "fixture-mpa"],
  mp3: ["fixture", "fixture-mp2l3", "fixture-ffe3"],
  mp4: [
    "fixture-imovie",
    "fixture-isom",
    "fixture-isomv2",
    "fixture-mp4v2",
    "fixture-dash",
  ],
  mts: ["fixture-raw", "fixture-bdav"],
  tif: ["fixture-big-endian", "fixture-little-endian", "fixture-bali"],
  gz: ["fixture"],
  xz: ["fixture.tar"],
  lz: ["fixture.tar"],
  Z: ["fixture.tar"],
  zst: ["fixture.tar"],
  mkv: ["fixture", "fixture2"],
  mpg: ["fixture", "fixture2", "fixture.ps", "fixture.sub"],
  heic: ["fixture-mif1", "fixture-msf1", "fixture-heic"],
  ape: ["fixture-monkeysaudio"],
  mpc: ["fixture-sv7", "fixture-sv8"],
  pcap: ["fixture-big-endian", "fixture-little-endian"],
  png: ["fixture", "fixture-itxt"],
  tar: ["fixture", "fixture-v7", "fixture-spaces", "fixture-pax"],
  mie: ["fixture-big-endian", "fixture-little-endian"],
  m4a: [
    "fixture-babys-songbook.m4b", // Actually it's an `.m4b`
  ],
  m4v: [
    "fixture",
    "fixture-2", // Previously named as `fixture.mp4`
  ],
  flac: [
    "fixture",
    "fixture-id3v2", // FLAC prefixed with ID3v2 header
  ],
  docx: ["fixture", "fixture2", "fixture-office365"],
  pptx: ["fixture", "fixture2", "fixture-office365"],
  xlsx: ["fixture", "fixture2", "fixture-office365"],
  ogx: [
    "fixture-unknown-ogg", // Manipulated fixture to unrecognized Ogg based file
  ],
  avif: [
    "fixture-yuv420-8bit", // Multiple bit-depths and/or subsamplings
    "fixture-sequence",
  ],
  eps: ["fixture", "fixture2"],
  cfb: [
    "fixture.msi",
    "fixture.xls",
    "fixture.doc",
    "fixture.ppt",
    "fixture-2.doc",
  ],
  asf: ["fixture", "fixture.wma", "fixture.wmv"],
  jxl: [
    "fixture", // Image data stored within JXL container
    "fixture2", // Bare image data with no container
  ],
  pdf: [
    "fixture",
    "fixture-adobe-illustrator", // PDF saved from Adobe Illustrator, using the default "[Illustrator Default]" preset
    "fixture-smallest", // PDF saved from Adobe Illustrator, using the preset "smallest PDF"
    "fixture-fast-web", // PDF saved from Adobe Illustrator, using the default "[Illustrator Default"] preset, but enabling "Optimize for Fast Web View"
    "fixture-printed", // PDF printed from Adobe Illustrator, but with a PDF printer.
    "fixture-minimal", // PDF written to be as small as the spec allows
  ],
  webm: [
    "fixture-null", // EBML DocType with trailing null character
  ],
  xml: [
    "fixture",
    "fixture-utf8-bom", // UTF-8 with BOM
    "fixture-utf16-be-bom", // UTF-16 little endian encoded XML, with BOM
    "fixture-utf16-le-bom", // UTF-16 big endian encoded XML, with BOM
  ],
  jls: ["fixture-normal", "fixture-hp1", "fixture-hp2", "fixture-hp3"],
  pst: ["fixture-sample"],
  dwg: ["fixture-line-weights"],
  j2c: ["fixture"],
  cpio: ["fixture-bin", "fixture-ascii"],
  vsdx: ["fixture-vsdx", "fixture-vstx"],
  vtt: [
    "fixture-vtt-linebreak",
    "fixture-vtt-space",
    "fixture-vtt-tab",
    "fixture-vtt-eof",
  ],
  lz4: ["fixture"],
  rm: ["fixture-realmedia-audio", "fixture-realmedia-video"],
  ppsx: ["fixture"],
  ppsm: ["fixture"],
  "tar.gz": ["fixture"],
  reg: ["fixture-win2000", "fixture-win95"],
  dat: ["fixture-unicode-tests"],
};

// Define an entry here only if the file type has potential
// for false-positives
export const falsePositives: Record<string, string[]> = {
  png: ["fixture-corrupt"],
  webp: ["fixture-json"],
};

// Known failing fixture
export const failingFixture = new Set([
  "fixture-password-protected.xls", // Excel / MS-OSHARED / Compound-File-Binary-Format
]);

type Fixture = {
  path: string;
  filename: string;
  type: string;
};

export function getFixtures(): Fixture[] {
  const paths: Fixture[] = [];
  for (const type of supportedExtensions) {
    if (Object.hasOwn(names, type) && names[type]) {
      for (const suffix of names[type]) {
        const filename = `${suffix ?? "fixture"}.${type}`;
        paths.push({
          path: join(__dirname, "fixture", filename),
          filename,
          type,
        });
      }
    } else {
      const filename = `fixture.${type}`;
      paths.push({
        path: join(__dirname, "fixture", filename),
        filename,
        type,
      });
    }
  }

  return paths;
}

export async function getStreamAsUint8Array(
  stream: AnyWebReadableStream<Uint8Array> | NodeReadableStream,
): Promise<Uint8Array> {
  return new Uint8Array(await getStreamAsArrayBuffer(stream));
}
