let workerPromise = null;
let progressFn = null;

export async function ocrImage(file, onProgress) {
  progressFn = onProgress || null;
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await import("tesseract.js");
      const worker = await T.createWorker(["chi_sim", "eng"], 1, {
        langPath: "/tessdata",
        logger: (m) => {
          if (m.status === "recognizing text" && progressFn) progressFn(m.progress || 0);
        },
      });
      return worker;
    })();
  }
  const worker = await workerPromise;
  const { data } = await worker.recognize(file);
  return (data && data.text) || "";
}
