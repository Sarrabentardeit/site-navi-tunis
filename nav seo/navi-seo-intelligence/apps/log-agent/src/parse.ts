/** Lecture d'une ligne d'access.log Apache au format « combined ». L'adresse IP n'est conservée que le temps de la vérification. */

export interface LogEntry {
  readonly ip: string;
  readonly timestamp: Date;
  readonly method: string;
  /** Chemin sans query ni fragment, tronqué à 300 caractères. */
  readonly path: string;
  readonly status: number;
  readonly userAgent: string;
}

const COMBINED = /^(\S+) \S+ \S+ \[([^\]]+)\] "([A-Z]+) (\S+) [^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"/;
const MONTHS: Readonly<Record<string, string>> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

export function parseLine(line: string): LogEntry | undefined {
  const m = COMBINED.exec(line);
  if (!m) return undefined;
  const d = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(m[2] as string);
  const month = d ? MONTHS[d[2] as string] : undefined;
  if (!d || !month) return undefined;
  const timestamp = new Date(`${d[3]}-${month}-${d[1]}T${d[4]}:${d[5]}:${d[6]}${d[7]}${d[8]}:${d[9]}`);
  if (Number.isNaN(timestamp.getTime())) return undefined;
  const raw = (m[4] as string).split(/[?#]/)[0] ?? "";
  // eslint-disable-next-line no-control-regex
  if (!raw.startsWith("/") || /[\u0000-\u001f\u007f]/.test(raw)) return undefined;
  return { ip: m[1] as string, timestamp, method: m[3] as string, path: raw.slice(0, 300), status: Number(m[5]), userAgent: m[6] as string };
}
