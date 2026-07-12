import { FileArchive, FileJson, X } from 'lucide-react';
import type { VolubleRecord } from '../domain/record';
import { recordFilename, serializeRecord } from '../domain/markdown';

const downloadBlob = (name: string, blob: Blob) => {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
};

export function ExportDialog({ records, onClose }: { records: VolubleRecord[]; onClose(): void }) {
  const json = () => { downloadBlob('voluble-records.json', new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' })); onClose(); };
  const markdown = async () => {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const record of records) zip.file(`${record.category}/${recordFilename(record)}`, serializeRecord(record));
    downloadBlob('voluble-markdown.zip', await zip.generateAsync({ type: 'blob' })); onClose();
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="export-dialog" role="dialog" aria-modal="true" aria-label="Export records"><header><div><span className="eyebrow">Portable backup</span><h2>Export</h2></div><button className="icon-button" onClick={onClose}><X /></button></header><p>Choose the format that works best for you.</p><div className="export-options"><button onClick={() => void markdown()}><FileArchive /><span><strong>Markdown files</strong><small>A ZIP organized by category</small></span></button><button onClick={json}><FileJson /><span><strong>JSON</strong><small>One complete structured index</small></span></button></div></section></div>;
}
