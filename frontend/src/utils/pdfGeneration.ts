import type { RetirementCertificateData } from "../types/retirementCertificate";

export interface PdfGenerationProgress {
  stage: "preparing" | "rendering" | "finalizing" | "done";
  percent: number;
}

export type PdfProgressCallback = (progress: PdfGenerationProgress) => void;

/**
 * Generates the retirement certificate PDF off the main thread.
 *
 * The heavy work is delegated to a Web Worker so the UI stays responsive.
 * When workers are unavailable (SSR, older browsers) it falls back to a
 * deferred, chunked generation on the main thread that yields between steps.
 */
export async function generateRetirementCertificatePdf(
  data: RetirementCertificateData,
  onProgress?: PdfProgressCallback,
): Promise<Blob> {
  const report = (stage: PdfGenerationProgress["stage"], percent: number) => {
    onProgress?.({ stage, percent });
  };

  report("preparing", 5);

  if (typeof Worker !== "undefined") {
    try {
      const blob = await generateWithWorker(data, report);
      report("done", 100);
      return blob;
    } catch {
      // Fall through to the deferred main-thread path below.
    }
  }

  const blob = await generateDeferred(data, report);
  report("done", 100);
  return blob;
}

function generateWithWorker(
  data: RetirementCertificateData,
  report: (stage: PdfGenerationProgress["stage"], percent: number) => void,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../workers/retirementCertificatePdf.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch (error) {
      reject(error);
      return;
    }

    const cleanup = () => {
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: "progress"; stage: PdfGenerationProgress["stage"]; percent: number }
        | { type: "done"; buffer: ArrayBuffer }
        | { type: "error"; message: string };

      if (message.type === "progress") {
        report(message.stage, message.percent);
        return;
      }

      if (message.type === "done") {
        cleanup();
        resolve(new Blob([message.buffer], { type: "application/pdf" }));
        return;
      }

      cleanup();
      reject(new Error(message.message));
    };

    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "PDF worker failed"));
    };

    worker.postMessage({ type: "generate", data });
  });
}

async function generateDeferred(
  data: RetirementCertificateData,
  report: (stage: PdfGenerationProgress["stage"], percent: number) => void,
): Promise<Blob> {
  const { buildRetirementCertificatePdf } = await import(
    "../workers/retirementCertificatePdf.worker"
  );

  report("rendering", 40);
  await yieldToMainThread();

  const bytes = await buildRetirementCertificatePdf(data, (percent) => {
    report("rendering", 40 + Math.round(percent * 0.5));
  });

  report("finalizing", 95);
  await yieldToMainThread();

  return new Blob([bytes], { type: "application/pdf" });
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
