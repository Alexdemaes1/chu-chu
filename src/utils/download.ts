/**
 * Descarga un Blob en el navegador con el nombre de fichero indicado.
 *
 * El enlace se añade al DOM antes del click (Firefox lo exige) y la URL se revoca con retraso
 * para que Safari tenga tiempo de iniciar la descarga.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
