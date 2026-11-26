/** Lecture incrémentale d'un fichier de log : offsets persistés, rotation détectée, lignes incomplètes laissées pour plus tard. */
import { open, stat } from "node:fs/promises";

export interface FileState {
  readonly offset: number;
  readonly ino: number;
}

export async function readNewLines(file: string, state: FileState | undefined, maxBytes = 8 * 1024 * 1024): Promise<{ lines: string[]; next: FileState }> {
  const st = await stat(file);
  // Rotation (autre inode) ou troncature : on repart du début du nouveau fichier.
  let offset = state && state.ino === st.ino && state.offset <= st.size ? state.offset : 0;
  if (!state) offset = 0;
  const length = Math.min(st.size - offset, maxBytes);
  if (length <= 0) return { lines: [], next: { offset, ino: st.ino } };
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, offset);
    const text = buf.toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return { lines: [], next: { offset, ino: st.ino } };
    const complete = text.slice(0, lastNl);
    return { lines: complete.split("\n").filter((l) => l.length > 0), next: { offset: offset + Buffer.byteLength(complete, "utf8") + 1, ino: st.ino } };
  } finally {
    await fh.close();
  }
}
