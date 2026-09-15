import { mkdir, readdir, copyFile } from "node:fs/promises";
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
const framedNames = (await readdir(screenshotDirectory)).filter((name) =>
  name.endsWith("-framed.png"),
).sort();
const framedSizes = [360, 720, 960];

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
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <linearGradient id="paper" x2="1" y2="1"><stop stop-color="#f8faff"/><stop offset="1" stop-color="#e3edff"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#93c5ff" stop-opacity=".5"/><stop offset="1" stop-color="#93c5ff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#paper)"/>
    <circle cx="990" cy="340" r="360" fill="url(#glow)"/>
    <g font-family="Arial, sans-serif">
      <text x="64" y="275" font-size="82" font-weight="700" letter-spacing="-3" fill="#09152d">RunWhale</text>
      <text x="68" y="342" font-size="35" fill="#2855ee">Dive deep. Get it done.</text>
      <text x="68" y="553" font-size="24" fill="#526480">runwhale.dev</text>
    </g>
  </svg>`);
  const mascot = await loadImage(iconSource).resize(560, 560).toBuffer();
  await sharp(background)
    .composite([{ input: mascot, left: 625, top: 46 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(ogSource);
  await copyFile(ogSource, outputPath("runwhale-og-1200x630.png"));
}

await mkdir(outputDirectory, { recursive: true });
await loadImage(iconSource).resize(512, 512).png()
  .toFile(path.join(projectDirectory, "src", "app", "icon.png"));

for (const size of iconSizes) {
  await generateIcon(size);
}

for (const name of screenshotNames) {
  for (const size of screenshotSizes) {
    await generateScreenshot(name, size);
  }
}

for (const name of framedNames) {
  for (const size of framedSizes) {
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
  framedNames.length * framedSizes.length * 2 +
  posterSizes.length +
  1;

console.log(
  `Generated ${generatedCount} optimized images in ${path.relative(projectDirectory, outputDirectory)}`,
);
