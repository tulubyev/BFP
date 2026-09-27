import { useState } from 'react';
import { downloadExport } from '../api/export';

interface ExportButtonsProps {
  /** Text before the buttons, e.g. «Скачать». */
  label: string;
  formats: { format: string; label: string }[];
  url(format: string): string;
  /** File name when the server sends none, without the extension. */
  fileBase: string;
  hint?: string;
  /** Reason the export is not possible right now (buttons disabled, reason shown). */
  disabledReason?: string;
}

/** Row of download buttons; errors (413, 503) are shown next to them, never saved as a file. */
export default function ExportButtons({ label, formats, url, fileBase, hint, disabledReason }: ExportButtonsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const download = async (format: string) => {
    setBusy(format);
    setError('');
    const result = await downloadExport(url(format), `${fileBase}.${format}`);
    if (!result.ok) setError(result.error);
    setBusy(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-400">{label}:</span>
      {formats.map(f => (
        <button
          key={f.format}
          type="button"
          disabled={Boolean(disabledReason) || busy !== null}
          onClick={() => download(f.format)}
          className="rounded-lg border border-slate-600 px-3 py-1.5 text-green-400 transition hover:border-green-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === f.format ? '…' : f.label}
        </button>
      ))}
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
      {disabledReason && <span className="w-full text-xs text-amber-300">{disabledReason}</span>}
      {error && <span role="alert" className="w-full text-xs text-red-300">{error}</span>}
    </div>
  );
}
