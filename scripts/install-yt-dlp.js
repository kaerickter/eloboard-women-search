const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const root = path.resolve(__dirname, "..");
const vendorDir = path.join(root, "vendor");
const isWindows = process.platform === "win32";
const fileName = isWindows ? "yt-dlp.exe" : "yt-dlp";
const outputPath = path.join(vendorDir, fileName);
const downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/" + fileName;

function download(url, target, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error("yt-dlp download redirected too many times"));
    const request = https.get(url, {
      headers: {
        "User-Agent": "elo-kitten-cctv-installer"
      }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const location = response.headers.location;
        if (!location) return reject(new Error("yt-dlp download redirect missing location"));
        return resolve(download(new URL(location, url).toString(), target, redirectCount + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error("yt-dlp download failed: HTTP " + response.statusCode));
      }
      const file = fs.createWriteStream(target);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

(async () => {
  fs.mkdirSync(vendorDir, { recursive: true });
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000000) {
    console.log("yt-dlp already installed:", outputPath);
    return;
  }
  const tempPath = outputPath + ".tmp";
  if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  console.log("Downloading yt-dlp:", downloadUrl);
  await download(downloadUrl, tempPath);
  fs.renameSync(tempPath, outputPath);
  if (!isWindows) fs.chmodSync(outputPath, 0o755);
  console.log("yt-dlp installed:", outputPath);
})().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
