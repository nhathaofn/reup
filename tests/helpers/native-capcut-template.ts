import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const minimalDraft = {
  id: 'template-draft', name: 'Template', duration: 1_000_000, fps: 30,
  canvas_config: { width: 1920, height: 1080 },
  tracks: [
    { id: 'video-track', type: 'video', name: 'Video nền', segments: [{ id: 'video-segment', material_id: 'video-material', target_timerange: { start: 0, duration: 1_000_000 }, source_timerange: { start: 0, duration: 1_000_000 }, speed: 1, volume: 0, extra_material_refs: [] }] },
    { id: 'audio-track', type: 'audio', name: 'Voice', segments: [{ id: 'audio-segment', material_id: 'audio-material', target_timerange: { start: 0, duration: 1_000_000 }, source_timerange: { start: 0, duration: 1_000_000 }, speed: 1, volume: 1, extra_material_refs: [] }] },
    { id: 'text-track', type: 'text', name: 'Phụ đề', segments: [{ id: 'text-segment', material_id: 'text-material', target_timerange: { start: 0, duration: 1_000_000 }, source_timerange: { start: 0, duration: 1_000_000 }, speed: 1, volume: 1, extra_material_refs: [] }] }
  ],
  materials: {
    videos: [{ id: 'video-material', path: '', material_name: 'video', duration: 1_000_000 }],
    audios: [{ id: 'audio-material', path: '', material_name: 'audio', duration: 1_000_000 }],
    texts: [{ id: 'text-material', content: JSON.stringify({ text: 'x', styles: [] }) }]
  }
}

export async function writeMinimalCapCutTemplate(root: string): Promise<string> {
  const templateDir = join(root, 'template')
  await mkdir(templateDir, { recursive: true })
  await writeFile(join(templateDir, 'draft_content.json'), JSON.stringify(minimalDraft), 'utf8')
  return templateDir
}
