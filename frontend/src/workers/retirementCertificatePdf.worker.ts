/// <reference lib="webworker" />

import { jsPDF } from 'jspdf';

interface CertificatePayload {
  certificateId: string;
  holderName: string;
  projectName: string;
  tonnesRetired: number;
  serialNumber: string;
  retirementDate: string;
  beneficiary?: string;
  retirementMessage?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function postProgress(progress: number) {
  ctx.postMessage({ type: 'progress', progress });
}

function buildCertificate(payload: CertificatePayload): ArrayBuffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  postProgress(0.2);

  doc.setDrawColor(22, 101, 52);
  doc.setLineWidth(3);
  doc.rect(24, 24, pageWidth - 48, pageHeight - 48);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(22, 101, 52);
  doc.text('Certificate of Carbon Retirement', pageWidth / 2, 90, {
    align: 'center',
  });

  postProgress(0.45);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.text('This certifies that', pageWidth / 2, 140, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(payload.holderName, pageWidth / 2, 172, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.text(
    `has retired ${payload.tonnesRetired.toLocaleString()} tonnes of CO2 from`,
    pageWidth / 2,
    204,
    { align: 'center' },
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(payload.projectName, pageWidth / 2, 234, { align: 'center' });

  postProgress(0.7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  const details = [
    `Serial Number: ${payload.serialNumber}`,
    `Retirement Date: ${payload.retirementDate}`,
    `Certificate ID: ${payload.certificateId}`,
  ];
  if (payload.beneficiary) {
    details.push(`Beneficiary: ${payload.beneficiary}`);
  }

  let y = 290;
  for (const line of details) {
    doc.text(line, pageWidth / 2, y, { align: 'center' });
    y += 20;
  }

  if (payload.retirementMessage) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    doc.text(payload.retirementMessage, pageWidth / 2, y + 20, {
      align: 'center',
      maxWidth: pageWidth - 160,
    });
  }

  postProgress(0.9);

  return doc.output('arraybuffer');
}

ctx.onmessage = (event: MessageEvent<CertificatePayload>) => {
  try {
    const buffer = buildCertificate(event.data);
    postProgress(1);
    ctx.postMessage({ type: 'done', buffer }, [buffer]);
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Failed to generate certificate PDF',
    });
  }
};

export {};
