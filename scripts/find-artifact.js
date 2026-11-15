const fs = require("fs");

const [,, VERSION, PROFILE, COMMIT_SHA] = process.argv;

const raw = JSON.parse(fs.readFileSync("builds.json", "utf8"));
const list = Array.isArray(raw) ? raw : [raw];

const url = b => b && b.artifacts && (b.artifacts.buildUrl || b.artifacts.applicationArchiveUrl);

// This commit's build first, then any finished build as a fallback.
const mine = list.find(b => b.gitCommitHash === COMMIT_SHA && url(b));
const any = list.find(b => url(b));
const pick = mine || any;

if (!pick) {
  console.error("no build carries an artifact:", JSON.stringify(list.map(b => ({ id: b.id, status: b.status })), null, 2));
  process.exit(1);
}

console.log("using build", pick.id, pick.status, "commit", pick.gitCommitHash, mine ? "(this commit)" : "(fallback)");
const artifactUrl = url(pick);
let ext = PROFILE === "production" ? "aab" : "apk";
if (artifactUrl.includes(".aab")) {
  ext = "aab";
} else if (artifactUrl.includes(".apk")) {
  ext = "apk";
}

fs.writeFileSync("artifact-url.txt", artifactUrl);
fs.writeFileSync("artifact-filename.txt", `long-take-${VERSION}-${PROFILE}.${ext}`);
