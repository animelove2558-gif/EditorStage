// The .esproj file: what is written (projectJson) and the checks a file must pass before it is loaded (parseProject).

/** The project as saved: sequences, media, bins, identity and the sequence In / Out. */
export const projectJson = (s) => JSON.stringify({
  projectId: s.projectId, projectName: s.projectName, sequence: s.sequence, media: s.media, bins: s.bins, seqs: s.seqs,
  inPoint: s.inPoint ?? null, outPoint: s.outPoint ?? null,
}, null, 2);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Problem with a sequence object, or null. */
function seqProblem(q, name) {
  if (!isObj(q)) return `${name} is missing`;
  if (!Array.isArray(q.tracks)) return `${name} has no track list`;
  if (!Array.isArray(q.clips)) return `${name} has no clip list`;
  if (q.tracks.some((t) => !isObj(t) || typeof t.id !== 'string')) return `${name} has a damaged track`;
  if (q.clips.some((c) => !isObj(c) || typeof c.id !== 'string' || !Number.isFinite(+c.start) || !Number.isFinite(+c.dur))) return `${name} has a damaged clip`;
  if (q.transitions != null && !Array.isArray(q.transitions)) return `${name} has a damaged transition list`;
  if (q.markers != null && !Array.isArray(q.markers)) return `${name} has a damaged marker list`;
  return null;
}
/**
 * Parse and check the text of a .esproj. Returns the project data; throws an Error with a readable reason when the file
 * is not JSON (cut short by a crash, not a project) or lacks the minimum structure the editor needs.
 */
export function parseProject(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`the file is not valid project data (${String(e.message || e).slice(0, 80)})`); }
  if (!isObj(data)) throw new Error('the file is not an EditorStage project');
  const p = seqProblem(data.sequence, 'the sequence'); if (p) throw new Error(p);
  if (data.media != null && (!Array.isArray(data.media) || data.media.some((m) => !isObj(m) || typeof m.id !== 'string'))) throw new Error('the media list is damaged');
  if (data.seqs != null) {
    if (!isObj(data.seqs)) throw new Error('the sequence list is damaged');
    for (const [id, q] of Object.entries(data.seqs)) { const e = seqProblem(q, `sequence ${q?.name || id}`); if (e) throw new Error(e); }
  }
  if (data.bins != null && !Array.isArray(data.bins)) throw new Error('the bin list is damaged');
  for (const k of ['inPoint', 'outPoint']) if (data[k] != null && !Number.isFinite(data[k])) delete data[k];
  return { ...data, media: data.media || [], seqs: data.seqs || {}, bins: data.bins || [] };
}
