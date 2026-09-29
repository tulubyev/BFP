import L from 'leaflet';

export interface FullscreenControl {
  control: L.Control;
  /** Updates the button after the state changed from outside (Esc, footer button). */
  setActive(active: boolean): void;
}

/** Map button «на всю высоту окна» under the zoom buttons; `toggle` flips the page's expanded state. */
export function addFullscreenControl(map: L.Map, toggle: () => void): FullscreenControl {
  let button: HTMLButtonElement | null = null;
  const FullscreenControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      button = L.DomUtil.create('button', '', container) as HTMLButtonElement;
      button.type = 'button';
      button.style.cssText = 'width:34px;height:34px;line-height:30px;font-size:18px;text-align:center;cursor:pointer;background:#fff;color:#111;border:0;padding:0';
      button.textContent = '⛶';
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(button, 'click', () => toggle());
      button.setAttribute('aria-label', 'Развернуть карту на всё окно');
      button.title = 'Развернуть карту на всё окно';
      return container;
    },
  });
  const control = new FullscreenControl();
  control.addTo(map);
  return {
    control,
    setActive(active: boolean) {
      if (!button) return;
      button.textContent = active ? '✕' : '⛶';
      const text = active ? 'Свернуть карту (Esc)' : 'Развернуть карту на всё окно';
      button.title = text;
      button.setAttribute('aria-label', text);
    },
  };
}
