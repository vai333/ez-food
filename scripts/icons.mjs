import sharp from "sharp";
import fs from "node:fs";
const svg = fs.readFileSync("public/icons/icon.svg");
const maskable = Buffer.from(fs.readFileSync("public/icons/icon.svg", "utf8").replace('rx="120"', 'rx="0"'));
await sharp(svg).resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icons/icon-512.png");
await sharp(svg).resize(180, 180).png().toFile("public/icons/apple-touch-icon.png");
await sharp(maskable).resize(512, 512).png().toFile("public/icons/maskable-512.png");
console.log("icons ok");
