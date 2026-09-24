/** Leaflet popup content built from text nodes, so data from external sources is never parsed as HTML. */
export function popupElement(
  title: string,
  rows: Array<[string, string]>,
  opts: { titleColor?: string; link?: { href: string; text: string } | null } = {},
): HTMLElement {
  const root = document.createElement('div');
  root.style.minWidth = '200px';
  const h = document.createElement('h3');
  h.style.cssText = `font-weight:bold;margin-bottom:6px;font-size:14px${opts.titleColor ? `;color:${opts.titleColor}` : ''}`;
  h.textContent = title;
  root.append(h);
  for (const [label, value] of rows) {
    const row = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = `${label}: `;
    row.append(strong, value);
    root.append(row);
  }
  if (opts.link) {
    const a = document.createElement('a');
    a.href = opts.link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.cssText = 'color:#60a5fa;font-size:11px';
    a.textContent = opts.link.text;
    const p = document.createElement('p');
    p.style.marginTop = '6px';
    p.append(a);
    root.append(p);
  }
  return root;
}
