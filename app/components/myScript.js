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
  var system = getMobileOperatingSystem();
  if (system.includes("iOS")) {
    if (
      window &&
      window.webkit &&
      window.webkit.messageHandlers &&
      window.webkit.messageHandlers.genAudio
    ) {
      window.webkit.messageHandlers.genAudio.postMessage(text);
    }
  } else if (system.includes("Android")) {
    // alert("is Android");
    Android.genAudio(text);
  }
}

function getMobileOperatingSystem() {
  var userAgent = navigator.userAgent || navigator.vendor || window.opera;

  // Windows Phone must come first because its UA also contains "Android"
  if (/windows phone/i.test(userAgent)) {
    return "Windows Phone";
  }

  if (/android/i.test(userAgent)) {
    return "Android";
  }

  // iOS detection from: http://stackoverflow.com/a/9039885/177710
  if (/iPad|iPhone|iPod/.test(userAgent) && !window.MSStream) {
    return "iOS";
  }

  return "unknown";
}

export function showAndroidToast(text) {
  Android.showToast(text);
}

export function showVersion(versionInfo) {
  document.getElementById("version").innerHTML = versionInfo;
}

// export function showVersion() {
//     window.showVersion("1.0.0");
//   }
