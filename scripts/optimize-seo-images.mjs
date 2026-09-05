import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(
  projectDirectory,
  "public",
  "media",
  "optimized",
  "v1",
);

const iconSource = path.join(projectDirectory, "public", "runwhale-icon.png");
const iconSizes = [128, 256, 512, 1024];

const screenshotDirectory = path.join(
  projectDirectory,
  "public",
  "media",
  "demo",
  "screenshots",
);
const screenshotNames = [
  "01-create-baby-game.png",
  "02-prompt-and-agent-plan.png",
  "03-approve-file-write.png",
  "04-checks-before-preview.png",
  "05-animal-parade-preview.png",
  "06-interaction-feedback.png",
].sort();
const screenshotSizes = [360, 720];

const posterSource = path.join(
  screenshotDirectory,
  "05-animal-parade-preview.png",
);
const posterSizes = [360, 720];

const ogSource = path.join(projectDirectory, "public", "og.png");

function outputPath(filename) {
  return path.join(outputDirectory, filename);
}

function loadImage(source) {
  return sharp(source, { failOn: "error", sequentialRead: true }).rotate();
}

async function generateIcon(size) {
  const resizeOptions = {
    width: size,
    height: size,
    fit: "inside",
    withoutEnlargement: true,
  };

  await loadImage(iconSource)
    .resize(resizeOptions)
    .avif({ quality: 65 })
    .toFile(outputPath(`runwhale-icon-${size}.avif`));

  await loadImage(iconSource)
    .resize(resizeOptions)
    .webp({ quality: 90, alphaQuality: 100 })
    .toFile(outputPath(`runwhale-icon-${size}.webp`));
}

async function generateScreenshot(name, size) {
  const source = path.join(screenshotDirectory, name);
  const baseName = path.parse(name).name;
  const resizeOptions = { width: size, withoutEnlargement: true };

  await loadImage(source)
    .resize(resizeOptions)
    .avif({ quality: 60 })
    .toFile(outputPath(`${baseName}-${size}.avif`));

  await loadImage(source)
    .resize(resizeOptions)
    .webp({ quality: 82 })
    .toFile(outputPath(`${baseName}-${size}.webp`));
}

async function generatePoster(size) {
  await loadImage(posterSource)
    .resize({ width: size, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outputPath(`runwhale-animal-parade-poster-${size}.webp`));
}

async function generateOgImage() {
  await loadImage(ogSource)
    .resize({
      width: 1200,
      height: 630,
      fit: "cover",
      position: "centre",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath("runwhale-og-1200x630.png"));
}

await mkdir(outputDirectory, { recursive: true });

for (const size of iconSizes) {
  await generateIcon(size);
}

for (const name of screenshotNames) {
  for (const size of screenshotSizes) {
    await generateScreenshot(name, size);
  }
}

for (const size of posterSizes) {
  await generatePoster(size);
}

await generateOgImage();

const generatedCount =
  iconSizes.length * 2 +
  screenshotNames.length * screenshotSizes.length * 2 +
  posterSizes.length +
  1;

console.log(
  `Generated ${generatedCount} optimized images in ${path.relative(projectDirectory, outputDirectory)}`,
);
