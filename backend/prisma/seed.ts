import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TAXONOMY: {
  name: string;
  slug: string;
  mimeTypes: string[];
  subcategories: { name: string; slug: string }[];
}[] = [
  {
    name: 'Graphics',
    slug: 'graphics',
    mimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/gif', 'image/webp', 'image/tiff', 'image/bmp', 'application/postscript', 'image/vnd.adobe.photoshop'],
    subcategories: [
      { name: 'Illustrations', slug: 'illustrations' },
      { name: 'UI Kits', slug: 'ui-kits' },
      { name: 'Icons', slug: 'icons' },
      { name: 'Textures & Materials', slug: 'textures-materials' },
      { name: 'Sprites', slug: 'sprites' },
      { name: 'Backgrounds', slug: 'backgrounds' },
      { name: 'Patterns', slug: 'patterns' },
      { name: 'Print Templates', slug: 'print-templates' },
      { name: 'Logo Templates', slug: 'logo-templates' },
    ],
  },
  {
    name: 'Photos',
    slug: 'photos',
    mimeTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/webp', 'image/x-raw', 'image/heic', 'image/heif'],
    subcategories: [
      { name: 'Nature', slug: 'nature' },
      { name: 'Architecture', slug: 'architecture' },
      { name: 'People', slug: 'people' },
      { name: 'Business', slug: 'business' },
      { name: 'Abstract', slug: 'abstract' },
      { name: 'Food', slug: 'food' },
      { name: 'Technology', slug: 'technology' },
    ],
  },
  {
    name: 'Audio',
    slug: 'audio',
    mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/aac', 'audio/x-m4a', 'audio/mp4'],
    subcategories: [
      { name: 'Music Tracks', slug: 'music-tracks' },
      { name: 'Sound Effects', slug: 'sound-effects' },
      { name: 'Loops', slug: 'loops' },
      { name: 'Ambience', slug: 'ambience' },
    ],
  },
  {
    name: 'Video',
    slug: 'video',
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/mpeg', 'video/x-matroska'],
    subcategories: [
      { name: 'Footage', slug: 'footage' },
      { name: 'Motion Graphics', slug: 'motion-graphics' },
      { name: 'Intros & Openers', slug: 'intros-openers' },
      { name: 'Lower Thirds', slug: 'lower-thirds' },
    ],
  },
  {
    name: 'Fonts',
    slug: 'fonts',
    mimeTypes: ['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-woff', 'application/vnd.ms-fontobject'],
    subcategories: [
      { name: 'Serif', slug: 'serif' },
      { name: 'Sans-Serif', slug: 'sans-serif' },
      { name: 'Script', slug: 'script' },
      { name: 'Display', slug: 'display' },
      { name: 'Monospace', slug: 'monospace' },
    ],
  },
  {
    name: '3D Models',
    slug: '3d-models',
    mimeTypes: ['model/gltf+json', 'model/gltf-binary', 'model/obj', 'application/octet-stream'],
    subcategories: [
      { name: 'Characters', slug: 'characters' },
      { name: 'Environments', slug: 'environments' },
      { name: 'Vehicles', slug: 'vehicles' },
      { name: 'Props', slug: 'props' },
      { name: 'Architecture', slug: 'architecture' },
      { name: 'Rigged', slug: 'rigged' },
    ],
  },
  {
    name: 'Templates',
    slug: 'templates',
    mimeTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint', 'image/png', 'image/jpeg', 'application/zip'],
    subcategories: [
      { name: 'Presentation', slug: 'presentation' },
      { name: 'Social Media', slug: 'social-media' },
      { name: 'Web', slug: 'web' },
      { name: 'Print', slug: 'print' },
    ],
  },
  {
    name: 'Scripts & Plugins',
    slug: 'scripts-plugins',
    mimeTypes: ['text/javascript', 'application/javascript', 'text/plain', 'application/zip', 'application/x-tar'],
    subcategories: [
      { name: 'Shaders', slug: 'shaders' },
      { name: 'Game Scripts', slug: 'game-scripts' },
      { name: 'Automation', slug: 'automation' },
      { name: 'Web Plugins', slug: 'web-plugins' },
    ],
  },
];

async function main() {
  console.log('Seeding taxonomy...');

  for (const cat of TAXONOMY) {
    const category = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, allowedMimeTypes: cat.mimeTypes },
      create: { name: cat.name, slug: cat.slug, allowedMimeTypes: cat.mimeTypes },
    });

    for (const sub of cat.subcategories) {
      await prisma.subcategory.upsert({
        where: { categoryId_slug: { categoryId: category.id, slug: sub.slug } },
        update: { name: sub.name },
        create: { categoryId: category.id, name: sub.name, slug: sub.slug },
      });
    }

    console.log(`  ✓ ${cat.name} (${cat.subcategories.length} subcategories)`);
  }

  console.log('Taxonomy seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
