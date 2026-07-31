// Keeping the drawing on your own disk.
//
// The editor already remembers the last drawing in the browser, which is fine for one
// drawing and no use at all for a house with a cellar, a ground floor and an attic, or
// for keeping a copy of what the architect sent beside what you have changed. This is
// the ordinary thing every other program does: a file, in a folder you chose, that you
// can copy, back up and mail to somebody.
//
// Where the browser allows it this uses the File System Access API, which gives a real
// Save that writes back over the file you opened. Where it does not — Firefox and
// Safari at the time of writing — it falls back to a download and a file picker, which
// cannot overwrite in place, so Save behaves as Save a copy and says so.

const TYPE = {
  description: 'Floor plan',
  accept: { 'application/json': ['.floorplan', '.json'] },
};

/** Whether this browser can write back to a file the user picked. */
export function canWriteInPlace() {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

export function canPick() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

/**
 * Open a drawing.
 *
 * @returns {handle, name, text} — `handle` is null when the browser cannot give one,
 *   which is what tells the caller that a later Save has nowhere to write back to.
 */
export async function openFile() {
  if (canPick()) {
    const [handle] = await window.showOpenFilePicker({ types: [TYPE], multiple: false });
    const file = await handle.getFile();
    return { handle, name: file.name, text: await file.text() };
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.floorplan,.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new DOMException('No file chosen', 'AbortError'));
        return;
      }
      resolve({ handle: null, name: file.name, text: await file.text() });
    });
    // Safari will not open the picker for an element that is not in the document.
    input.style.position = 'fixed';
    input.style.left = '-1000px';
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 60000);
  });
}

/** Write to the file that was opened, without asking again. */
export async function writeTo(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(new Blob([text], { type: 'application/json' }));
  await writable.close();
}

/**
 * Ask where to put it, then put it there.
 *
 * @returns {handle, name} or null if the user changed their mind
 */
export async function saveFileAs(text, suggestedName) {
  if (canWriteInPlace()) {
    const handle = await window.showSaveFilePicker({ types: [TYPE], suggestedName });
    await writeTo(handle, text);
    return { handle, name: handle.name ?? suggestedName };
  }
  download(text, suggestedName);
  return { handle: null, name: suggestedName };
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** A name that will not upset a file system, ending in the extension we use. */
export function documentName(name) {
  const base = String(name || 'floor plan')
    .trim()
    .replace(/\.(floorplan|json)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .slice(0, 80);
  return `${base || 'floor plan'}.floorplan`;
}

/** Whether the user meant to cancel, which is not an error worth reporting. */
export function wasCancelled(err) {
  return !!err && (err.name === 'AbortError' || err.name === 'NotAllowedError');
}
