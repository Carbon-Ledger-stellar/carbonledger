'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export interface RetirementCertificatePdfProps {
  certificateId: string;
  holderName: string;
  projectName: string;
  tonnesRetired: number;
  serialNumber: string;
  retirementDate: string;
  beneficiary?: string;
  retirementMessage?: string;
  fileName?: string;
}

type WorkerStatus =
  | { state: 'idle' }
  | { state: 'generating'; progress: number }
  | { state: 'ready'; blob: Blob }
  | { state: 'error'; message: string };

/**
 * Renders a button that generates the retirement certificate PDF off the main
 * thread (in a Web Worker) and triggers a download once ready. The generated
 * PDF content is identical to the previous synchronous implementation.
 */
export default function RetirementCertificatePdf({
  certificateId,
  holderName,
  projectName,
  tonnesRetired,
  serialNumber,
  retirementDate,
  beneficiary,
  retirementMessage,
  fileName,
}: RetirementCertificatePdfProps) {
  const [status, setStatus] = useState<WorkerStatus>({ state: 'idle' });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const downloadBlob = useCallback(
    (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        fileName ?? `retirement-certificate-${certificateId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    [certificateId, fileName],
  );

  const handleGenerate = useCallback(() => {
    if (status.state === 'generating') return;

    setStatus({ state: 'generating', progress: 0 });

    const worker = new Worker(
      new URL('../workers/retirementCertificatePdf.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type: 'progress'; progress: number }
        | { type: 'done'; buffer: ArrayBuffer }
        | { type: 'error'; message: string };

      if (data.type === 'progress') {
        setStatus({ state: 'generating', progress: data.progress });
        return;
      }

      if (data.type === 'done') {
        const blob = new Blob([data.buffer], { type: 'application/pdf' });
        setStatus({ state: 'ready', blob });
        downloadBlob(blob);
        worker.terminate();
        workerRef.current = null;
        return;
      }

      setStatus({ state: 'error', message: data.message });
      worker.terminate();
      workerRef.current = null;
    };

    worker.onerror = (event: ErrorEvent) => {
      setStatus({
        state: 'error',
        message: event.message || 'Failed to generate certificate PDF',
      });
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({
      certificateId,
      holderName,
      projectName,
      tonnesRetired,
      serialNumber,
      retirementDate,
      beneficiary,
      retirementMessage,
    });
  }, [
    status.state,
    certificateId,
    holderName,
    projectName,
    tonnesRetired,
    serialNumber,
    retirementDate,
    beneficiary,
    retirementMessage,
    downloadBlob,
  ]);

  const isGenerating = status.state === 'generating';

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating}
        aria-busy={isGenerating}
      >
        {isGenerating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Generating PDF…
          </>
        ) : (
          'Download Certificate PDF'
        )}
      </Button>

      {isGenerating && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(status.progress * 100)}
          aria-label="Generating certificate PDF"
        >
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${Math.round(status.progress * 100)}%` }}
          />
        </div>
      )}

      {status.state === 'error' && (
        <p className="text-sm text-destructive" role="alert">
          {status.message}
        </p>
      )}
    </div>
  );
}
