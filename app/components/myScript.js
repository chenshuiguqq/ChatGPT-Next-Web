export function getVersion() {
  if (
    window &&
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.getVersion
  ) {
    window.webkit.messageHandlers.getVersion.postMessage(null);
  }
}

// export function showVersion(versionInfo) {
//     document.getElementById("version").innerHTML = versionInfo;
// }

// export function showVersion() {
//     window.showVersion("1.0.0");
//   }
