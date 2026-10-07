import { useEffect, useRef, useState } from 'react';

export type MenuItem =
  | { label: string; shortcut?: string; disabled?: boolean; onClick: () => void }
  | 'sep';

export interface Menu {
  label: string;
  items: MenuItem[];
}

/** Underline the first letter, Win98 style. */
const Mnemonic = ({ text }: { text: string }) => (
  <span>
    <u>{text[0]}</u>
    {text.slice(1)}
  </span>
);

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="menubar" ref={ref}>
      {menus.map((m, i) => (
        <div
          key={m.label}
          className={`menu${open === i ? ' open' : ''}`}
          onPointerEnter={() => open !== null && setOpen(i)}
        >
          <span className="label" onPointerDown={() => setOpen(open === i ? null : i)}>
            <Mnemonic text={m.label} />
          </span>
          {open === i && (
            <div className="dropdown">
              {m.items.map((it, j) =>
                it === 'sep' ? (
                  <div key={j} className="sep" />
                ) : (
                  <div
                    key={j}
                    className={`item${it.disabled ? ' disabled' : ''}`}
                    onClick={() => {
                      if (it.disabled) return;
                      setOpen(null);
                      it.onClick();
                    }}
                  >
                    <span>{it.label}</span>
                    {it.shortcut && <span>{it.shortcut}</span>}
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
