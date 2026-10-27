import { useRef } from 'react';

import { Button, type ButtonProps } from './Button';

export interface FileButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  /** Доступное имя и текст кнопки («Загрузить маршрут»). */
  label: string;
  /** Фильтр системного окна выбора (`.gpx,.kml`); формат проверяет сервер по содержимому. */
  accept: string;
  onFile: (file: File) => void;
}

/**
 * Кнопка выбора файла: обычная кнопка панели + скрытый `<input type="file">` (не в порядке фокуса). Фокус остаётся на
 * кнопке — окно, открытое после выбора, вернёт его сюда. Повторный выбор того же файла снова вызывает `onFile`.
 */
export function FileButton({ label, accept, onFile, ...button }: FileButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button {...button} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}
