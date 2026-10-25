/** @type {import('expo/metro-config').MetroConfig} */
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("sql");

// Native build output is not source. Watching it crashed Metro (ENOENT) when a
// Gradle build deleted a generated folder under the watcher, which took the
// dev-client tunnel down mid-session.
const nativeBuild = /[/\\](android|ios)[/\\](.*[/\\])?(build|\.gradle|\.cxx)[/\\].*/;
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList].filter(Boolean)),
  nativeBuild,
];

// Add wasm asset support
config.resolver.assetExts.push("wasm");

config.resolver.unstable_conditionNames = [
  "browser",
  "require",
  "react-native",
];

// Add COEP and COOP headers to support SharedArrayBuffer
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    middleware(req, res, next);
  };
};

module.exports = withNativeWind(config, {
  input: "./app/global.css",
  configPath: "./tailwind.config.ts",
});
