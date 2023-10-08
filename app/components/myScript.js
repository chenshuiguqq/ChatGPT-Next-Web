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

export function genAudio(text) {
  if (
    window &&
    window.webkit &&
    window.webkit.messageHandlers &&
    window.webkit.messageHandlers.genAudio
  ) {
    window.webkit.messageHandlers.genAudio.postMessage(text);
  }
}

export function showVersion(versionInfo) {
  document.getElementById("version").innerHTML = versionInfo;
}

// export function showVersion() {
//     window.showVersion("1.0.0");
//   }
