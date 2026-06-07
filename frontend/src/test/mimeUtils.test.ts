import { describe, it, expect } from 'vitest';
import { EXT_TO_MIME, resolveMimeType, resolveRenderer } from '../components/FileViewer/mimeUtils.js';

// ─── resolveMimeType ──────────────────────────────────────────────────────────

describe('resolveMimeType', () => {
  it('returns the provided mime type when valid', () => {
    expect(resolveMimeType('image/jpeg', 'photo.jpg')).toBe('image/jpeg');
  });

  it('falls back to extension lookup when mime_type is null', () => {
    expect(resolveMimeType(null, 'document.pdf')).toBe('application/pdf');
  });

  it('falls back to extension lookup when mime_type is octet-stream', () => {
    expect(resolveMimeType('application/octet-stream', 'archive.zip')).toBe('application/zip');
  });

  it('uses extension case-insensitively', () => {
    expect(resolveMimeType(null, 'PHOTO.JPG')).toBe('image/jpeg');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(resolveMimeType(null, 'file.xyz')).toBe('application/octet-stream');
  });

  it('returns octet-stream for files with no extension', () => {
    expect(resolveMimeType(null, 'Makefile')).toBe('application/octet-stream');
  });
});

// ─── EXT_TO_MIME completeness ─────────────────────────────────────────────────

describe('EXT_TO_MIME — Phase 1 extensions', () => {
  it.each([
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp'],
    ['avif', 'image/avif'],
    ['svg', 'image/svg+xml'],
    ['mp3', 'audio/mpeg'],
    ['wav', 'audio/wav'],
    ['ogg', 'audio/ogg'],
    ['flac', 'audio/flac'],
    ['aac', 'audio/aac'],
    ['mp4', 'video/mp4'],
    ['webm', 'video/webm'],
    ['mov', 'video/quicktime'],
    ['pdf', 'application/pdf'],
    ['txt', 'text/plain'],
    ['md', 'text/markdown'],
    ['json', 'application/json'],
    ['xml', 'application/xml'],
    ['csv', 'text/csv'],
    ['yaml', 'application/yaml'],
    ['yml', 'application/yaml'],
  ] as const)('maps .%s → %s', (ext, expected) => {
    expect(EXT_TO_MIME[ext]).toBe(expected);
  });
});

describe('EXT_TO_MIME — Phase 2 extensions', () => {
  it.each([
    ['glb', 'model/gltf-binary'],
    ['gltf', 'model/gltf+json'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['zip', 'application/zip'],
    ['psd', 'application/x-photoshop'],
  ] as const)('maps .%s → %s', (ext, expected) => {
    expect(EXT_TO_MIME[ext]).toBe(expected);
  });
});

// ─── resolveRenderer ─────────────────────────────────────────────────────────

describe('resolveRenderer — Phase 1 formats', () => {
  it.each([
    ['image/jpeg'],
    ['image/png'],
    ['image/gif'],
    ['image/webp'],
    ['image/avif'],
    ['image/svg+xml'],
  ])('routes %s → image', (mime) => {
    expect(resolveRenderer(mime)).toBe('image');
  });

  it.each([
    ['audio/mpeg'],
    ['audio/wav'],
    ['audio/ogg'],
    ['audio/flac'],
    ['audio/aac'],
  ])('routes %s → audio', (mime) => {
    expect(resolveRenderer(mime)).toBe('audio');
  });

  it.each([
    ['video/mp4'],
    ['video/webm'],
    ['video/quicktime'],
  ])('routes %s → video', (mime) => {
    expect(resolveRenderer(mime)).toBe('video');
  });

  it('routes application/pdf → pdf', () => {
    expect(resolveRenderer('application/pdf')).toBe('pdf');
  });

  it.each([
    ['text/plain'],
    ['text/markdown'],
    ['application/json'],
    ['application/xml'],
    ['text/csv'],
    ['application/yaml'],
  ])('routes %s → code', (mime) => {
    expect(resolveRenderer(mime)).toBe('code');
  });
});

describe('resolveRenderer — Phase 2 formats', () => {
  it.each([
    ['model/gltf-binary'],
    ['model/gltf+json'],
  ])('routes %s → model', (mime) => {
    expect(resolveRenderer(mime)).toBe('model');
  });

  it.each([
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('routes %s → office', (mime) => {
    expect(resolveRenderer(mime)).toBe('office');
  });

  it('routes application/zip → archive', () => {
    expect(resolveRenderer('application/zip')).toBe('archive');
  });
});

describe('resolveRenderer — unsupported / fallback formats', () => {
  it.each([
    ['application/octet-stream', '.exe'],
    ['application/x-photoshop', '.psd (application mime)'],
    ['image/vnd.adobe.photoshop', '.psd (standard mime)'],
    ['image/x-photoshop', '.psd (alt mime)'],
    ['application/x-blender', '.blend'],
    ['application/x-rar-compressed', '.rar'],
    ['application/x-7z-compressed', '.7z'],
  ])('routes %s (%s) → unsupported', (mime) => {
    expect(resolveRenderer(mime)).toBe('unsupported');
  });

  it('routes image/vnd.adobe.photoshop (PSD) → unsupported', () => {
    expect(resolveRenderer('image/vnd.adobe.photoshop')).toBe('unsupported');
  });
});

// ─── Round-trip: extension → mime → renderer ─────────────────────────────────

describe('round-trip: extension → mime → renderer', () => {
  const roundTrips: [string, string, string][] = [
    // Phase 1 images
    ['jpg', 'image/jpeg', 'image'],
    ['png', 'image/png', 'image'],
    ['gif', 'image/gif', 'image'],
    ['webp', 'image/webp', 'image'],
    ['avif', 'image/avif', 'image'],
    ['svg', 'image/svg+xml', 'image'],
    // Phase 1 audio
    ['mp3', 'audio/mpeg', 'audio'],
    ['wav', 'audio/wav', 'audio'],
    ['ogg', 'audio/ogg', 'audio'],
    ['flac', 'audio/flac', 'audio'],
    ['aac', 'audio/aac', 'audio'],
    // Phase 1 video
    ['mp4', 'video/mp4', 'video'],
    ['webm', 'video/webm', 'video'],
    ['mov', 'video/quicktime', 'video'],
    // Phase 1 document
    ['pdf', 'application/pdf', 'pdf'],
    // Phase 1 code/text
    ['txt', 'text/plain', 'code'],
    ['md', 'text/markdown', 'code'],
    ['json', 'application/json', 'code'],
    ['xml', 'application/xml', 'code'],
    ['csv', 'text/csv', 'code'],
    ['yaml', 'application/yaml', 'code'],
    ['yml', 'application/yaml', 'code'],
    // Phase 2
    ['glb', 'model/gltf-binary', 'model'],
    ['gltf', 'model/gltf+json', 'model'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'office'],
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'office'],
    ['zip', 'application/zip', 'archive'],
    ['psd', 'application/x-photoshop', 'unsupported'],
  ];

  it.each(roundTrips)('.%s with null mime → renderer %s', (ext, _expectedMime, expectedRenderer) => {
    const mime = resolveMimeType(null, `file.${ext}`);
    expect(resolveRenderer(mime)).toBe(expectedRenderer);
  });
});
