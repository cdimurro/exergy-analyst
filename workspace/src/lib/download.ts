/**
 * downloadBlob — serialize blob downloads and avoid the Chrome
 * "multiple automatic downloads" silent block.
 *
 * Prior pattern (createObjectURL → appendChild → click → setTimeout(revoke, 1000))
 * left anchors in the DOM for 1s and fired two downloads in the same tick
 * when the user clicked Export JSON right after Export PDF — Chrome would
 * block the second one without a visible prompt, requiring a refresh.
 *
 * This helper:
 *   - revokes the URL on the next microtask instead of after 1s
 *   - detaches the anchor immediately after click
 *   - serializes downloads through a shared promise chain so two calls in
 *     flight never reach the browser as "concurrent" downloads
 */

// Space concurrent downloads by ~120ms so Chrome doesn't flag them as a
// multi-download burst from the same origin. Value chosen empirically —
// shorter delays (50ms) still tripped the silent block on rapid clicks.
const DOWNLOAD_SPACING_MS = 120;

// Filename slug cap shared across PDF export call sites. Keeps exported
// filenames reasonable across OSes and leaves room for the browser's
// " (1)" disambiguators.
export const MAX_PDF_SLUG_LEN = 80;

let chain: Promise<void> = Promise.resolve();

export function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("downloadBlob called in non-browser context"));
  }
  chain = chain.then(() => runDownload(blob, filename));
  return chain;
}

function runDownload(blob: Blob, filename: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser one tick to start the download before we revoke.
    queueMicrotask(() => {
      URL.revokeObjectURL(url);
      setTimeout(resolve, DOWNLOAD_SPACING_MS);
    });
  });
}
