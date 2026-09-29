import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RegionsApiError, fetchRegionDetail, type RegionDetailResponse } from '../api/regions';
import RegionReport from '../components/regions/RegionReport';
import { REGIONS_TABLE_PATH, parseReportIso, reportDocumentTitle } from '../utils/regionReport';

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: RegionDetailResponse; printedAt: Date };

/** Screen-only message with a way back to the regions table (hidden in print). */
export function ReportNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-center" role="alert">
      <h1 className="text-xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-gray-400">{message}</p>
      <Link to={REGIONS_TABLE_PATH} className="mt-4 inline-block text-green-400 underline hover:text-green-300">К таблице регионов</Link>
    </div>
  );
}

/** Toolbar above the sheet: back link and the print button; never printed. */
export function ReportToolbar({ ready }: { ready: boolean }) {
  return (
    <div className="mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 print:hidden">
      <Link to={REGIONS_TABLE_PATH} className="text-sm text-gray-400 hover:text-green-400">← К таблице регионов</Link>
      <button type="button" onClick={() => window.print()} disabled={!ready} className="btn-primary text-sm disabled:opacity-50">
        Печать / сохранить как PDF
      </button>
    </div>
  );
}

/** /regions/:iso/report — print-ready region report (spec 2026-09-29 part R). */
export default function RegionReportPage() {
  const { iso: rawIso } = useParams();
  const check = useMemo(() => parseReportIso(rawIso), [rawIso]);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    if (!check.ok) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetchRegionDetail(check.iso)
      .then(detail => { if (!cancelled) setState({ status: 'ready', detail, printedAt: new Date() }); })
      .catch(err => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        const status = err instanceof RegionsApiError ? err.status : 0;
        setState(status === 400 || status === 404 ? { status: 'not-found', message } : { status: 'error', message });
      });
    return () => { cancelled = true; };
  }, [check]);

  const name = state.status === 'ready' ? state.detail.name : null;
  useEffect(() => {
    if (!name) return;
    const previous = document.title;
    document.title = reportDocumentTitle(name);
    return () => { document.title = previous; };
  }, [name]);

  if (!check.ok) return <ReportNotice title="Субъект не найден" message={check.error} />;
  if (state.status === 'not-found') return <ReportNotice title="Субъект не найден" message={state.message} />;

  return (
    <div className="report-page px-2 py-4 sm:px-4 sm:py-8 print:p-0">
      <ReportToolbar ready={state.status === 'ready'} />
      {state.status === 'loading' && <p className="py-10 text-center text-gray-400">Загрузка отчёта…</p>}
      {state.status === 'error' && (
        <p className="py-10 text-center text-gray-400">Нет данных: не удалось загрузить данные субъекта ({state.message})</p>
      )}
      {state.status === 'ready' && <RegionReport detail={state.detail} printedAt={state.printedAt} />}
    </div>
  );
}
