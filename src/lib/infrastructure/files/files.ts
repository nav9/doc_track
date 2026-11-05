/**
 * File-system helpers. Everything stays local: downloads use a Blob URL, file
 * input reads a File object, and the optional backup folder uses the File System
 * Access API when the browser supports it. No request is made to a server.
 */

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickTextFile(accept = '.txt,.json,.doctrack,application/json,text/plain'): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const finish = (result: { name: string; text: string } | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(result);
    };
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      try {
        finish({ name: file.name, text: await file.text() });
      } catch {
        finish(null);
      }
    });
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

export async function readClipboard(): Promise<string> {
  if (!navigator.clipboard?.readText) {
    throw new Error('This browser does not allow reading the clipboard. Use the file import instead.');
  }
  return navigator.clipboard.readText();
}

export async function writeClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('This browser does not allow copying. Download the file instead.');
  }
  await navigator.clipboard.writeText(text);
}

export function filenameTimestamp(date = new Date()): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getDate()}${months[date.getMonth()]}${date.getFullYear()}_${pad(
    date.getHours()
  )}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
}

export function backupFilename(date = new Date()): string {
  return `DocTrack_${filenameTimestamp(date)}.txt`;
}

export interface DirectoryHandleLike {
  name: string;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{
      write(data: string | Blob): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
}

export function supportsDirectoryPicker(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export async function pickDirectory(): Promise<DirectoryHandleLike | null> {
  if (!supportsDirectoryPicker()) return null;
  const picker = (
    window as unknown as {
      showDirectoryPicker(options?: { mode?: 'readwrite' }): Promise<DirectoryHandleLike>;
    }
  ).showDirectoryPicker;
  try {
    return await picker({ mode: 'readwrite' });
  } catch {
    return null;
  }
}

export async function ensureWritePermission(handle: DirectoryHandleLike): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  const state = await handle.queryPermission({ mode: 'readwrite' });
  if (state === 'granted') return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function writeFileToDirectory(
  directory: DirectoryHandleLike,
  filename: string,
  content: string
): Promise<void> {
  if (!(await ensureWritePermission(directory))) {
    throw new Error('Write permission for the backup folder was not granted.');
  }
  const file = await directory.getFileHandle(filename, { create: true });
  const writable = await file.createWritable();
  await writable.write(content);
  await writable.close();
}

export function isStandalonePwa(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isProbablyPrivateMode(): boolean | null {
  return null;
}
