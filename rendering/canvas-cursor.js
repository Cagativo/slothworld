const CURSOR_CLASS = 'slothworld-cursor';
const CLICKING_CLASS = 'slothworld-cursor-clicking';

function restoreCursor(canvas) {
  if (!canvas || !canvas.classList) return;
  canvas.classList.remove(CLICKING_CLASS);
  canvas.classList.add(CURSOR_CLASS);
}

function pressCursor(canvas) {
  if (!canvas || !canvas.classList) return;
  canvas.classList.add(CURSOR_CLASS);
  canvas.classList.add(CLICKING_CLASS);
}

export function initCanvasCursor(canvas, win = globalThis.window) {
  if (!canvas || typeof canvas.addEventListener !== 'function') {
    return () => {};
  }

  restoreCursor(canvas);

  const onDown = () => pressCursor(canvas);
  const onRestore = () => restoreCursor(canvas);
  const onBlur = () => restoreCursor(canvas);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onRestore);
  canvas.addEventListener('pointerleave', onRestore);
  canvas.addEventListener('pointercancel', onRestore);
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mouseup', onRestore);
  canvas.addEventListener('mouseleave', onRestore);

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('pointerup', onRestore);
    win.addEventListener('mouseup', onRestore);
    win.addEventListener('blur', onBlur);
  }

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onRestore);
    canvas.removeEventListener('pointerleave', onRestore);
    canvas.removeEventListener('pointercancel', onRestore);
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('mouseup', onRestore);
    canvas.removeEventListener('mouseleave', onRestore);

    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('pointerup', onRestore);
      win.removeEventListener('mouseup', onRestore);
      win.removeEventListener('blur', onBlur);
    }
  };
}
