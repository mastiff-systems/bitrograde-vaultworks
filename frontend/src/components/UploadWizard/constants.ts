export const ALLOWED_LICENSES = [
  { value: 'CC0-1.0', label: 'CC0 1.0 Universal (Public Domain)' },
  { value: 'CC-BY-4.0', label: 'Creative Commons Attribution 4.0' },
  { value: 'CC-BY-SA-4.0', label: 'CC Attribution-ShareAlike 4.0' },
  { value: 'CC-BY-NC-4.0', label: 'CC Attribution-NonCommercial 4.0' },
  { value: 'MIT', label: 'MIT License' },
  { value: 'GPL-3.0-only', label: 'GNU GPL v3.0' },
  { value: 'Proprietary', label: 'Proprietary / All Rights Reserved' },
];

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
export const MAX_DESCRIPTION_CHARS = 2000;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 100;
export const MAX_CUSTOM_NAME_CHARS = 255;
