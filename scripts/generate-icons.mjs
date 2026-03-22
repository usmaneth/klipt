import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'app-icons');
const svgPath = join(outDir, 'klipt-icon.svg');
const svgBuffer = readFileSync(svgPath);

const sizes = [16, 32, 64, 128, 256, 512, 1024];

async function generate() {
  for (const size of sizes) {
    const outPath = join(outDir, `klipt-${size}.png`);
    // Use a reasonable density - render SVG at 4x target then downscale, capped for large sizes
    const density = Math.min(Math.round((72 * size) / 48), 600);
    await sharp(svgBuffer, { density })
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`Generated ${outPath} (${size}x${size})`);
  }

  // Generate .icns using macOS iconutil
  try {
    const iconsetDir = join(outDir, 'klipt.iconset');
    mkdirSync(iconsetDir, { recursive: true });

    // iconutil requires specific naming: icon_NxN.png and icon_NxN@2x.png
    const iconsetSizes = [
      { name: 'icon_16x16.png', size: 16 },
      { name: 'icon_16x16@2x.png', size: 32 },
      { name: 'icon_32x32.png', size: 32 },
      { name: 'icon_32x32@2x.png', size: 64 },
      { name: 'icon_128x128.png', size: 128 },
      { name: 'icon_128x128@2x.png', size: 256 },
      { name: 'icon_256x256.png', size: 256 },
      { name: 'icon_256x256@2x.png', size: 512 },
      { name: 'icon_512x512.png', size: 512 },
      { name: 'icon_512x512@2x.png', size: 1024 },
    ];

    for (const { name, size } of iconsetSizes) {
      const d = Math.min(Math.round((72 * size) / 48), 600);
      await sharp(svgBuffer, { density: d })
        .resize(size, size)
        .png()
        .toFile(join(iconsetDir, name));
    }

    const icnsPath = join(outDir, 'klipt.icns');
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath]);
    console.log(`Generated ${icnsPath}`);

    // Clean up iconset directory
    execFileSync('rm', ['-rf', iconsetDir]);
  } catch (err) {
    console.error('Could not generate .icns:', err.message);
  }
}

generate().then(() => console.log('Done!')).catch(console.error);
