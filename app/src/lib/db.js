import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

export const hasKey = Boolean(SUPABASE_ANON_KEY)
export const supabase = hasKey ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null

function ok({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

// ---------- reads ----------

export async function getJobs() {
  return ok(await supabase.from('bedrock_jobs').select('*').order('job_number'))
}

export async function getEquipment(jobId) {
  return ok(await supabase.from('bedrock_equipment').select('*').eq('job_id', jobId).order('name'))
}

export async function getPiles(jobId) {
  return ok(
    await supabase
      .from('bedrock_piles')
      .select('*')
      .eq('job_id', jobId)
      .order('sort_order', { ascending: true, nullsFirst: false })
  )
}

// Everything the log screen and export need for one pile.
export async function getPileBundle(pileId) {
  const [pile, days, events, blows, tickets] = await Promise.all([
    ok(await supabase.from('bedrock_piles').select('*, mix:bedrock_mix_designs(*)').eq('id', pileId).single()),
    ok(await supabase.from('bedrock_log_days').select('*, equipment:bedrock_equipment(*)').eq('pile_id', pileId).order('work_date')),
    ok(await supabase.from('bedrock_events').select('*').eq('pile_id', pileId).order('ts')),
    ok(await supabase.from('bedrock_blow_counts').select('*').eq('pile_id', pileId).order('depth_ft')),
    ok(await supabase.from('bedrock_concrete_tickets').select('*').eq('pile_id', pileId).order('ts')),
  ])
  return { pile, days, events, blows, tickets }
}

// Every obstruction event across a whole job, with its pile.
export async function getJobObstructions(jobId) {
  return ok(
    await supabase
      .from('bedrock_events')
      .select('*, pile:bedrock_piles!inner(id, label, job_id)')
      .in('event_type', ['obstruction_hit', 'obstruction_cleared'])
      .eq('pile.job_id', jobId)
      .order('ts')
  )
}

// ---------- writes ----------

export async function startDay(pileId, { equipmentId = null, engineer = null } = {}) {
  const today = new Date().toISOString().slice(0, 10)
  return ok(
    await supabase
      .from('bedrock_log_days')
      .upsert(
        { pile_id: pileId, work_date: today, day_start: new Date().toISOString(), equipment_id: equipmentId, engineer },
        { onConflict: 'pile_id,work_date' }
      )
      .select()
  )
}

export async function endDay(pileId) {
  const today = new Date().toISOString().slice(0, 10)
  return ok(
    await supabase
      .from('bedrock_log_days')
      .update({ day_end: new Date().toISOString() })
      .eq('pile_id', pileId)
      .eq('work_date', today)
      .select()
  )
}

export async function addEvent(pileId, eventType, data = {}) {
  return ok(
    await supabase
      .from('bedrock_events')
      .insert({ pile_id: pileId, event_type: eventType, data, ts: new Date().toISOString() })
      .select()
      .single()
  )
}

export async function updateEvent(id, data) {
  return ok(await supabase.from('bedrock_events').update({ data }).eq('id', id).select().single())
}

export async function setPileStatus(pileId, status) {
  return ok(await supabase.from('bedrock_piles').update({ status }).eq('id', pileId).select().single())
}

export async function updatePile(pileId, patch) {
  return ok(await supabase.from('bedrock_piles').update(patch).eq('id', pileId).select().single())
}

export async function addBlow(pileId, depthFt, blows, strokeFt) {
  return ok(
    await supabase
      .from('bedrock_blow_counts')
      .insert({ pile_id: pileId, depth_ft: depthFt, blows, stroke_ft: strokeFt, ts: new Date().toISOString() })
      .select()
      .single()
  )
}

// A "run": the pile dropped through several feet — record 0 blows for each.
export async function addBlowRun(pileId, fromDepthFt, toDepthFt) {
  const rows = []
  for (let d = fromDepthFt; d <= toDepthFt; d++) {
    rows.push({ pile_id: pileId, depth_ft: d, blows: 0, stroke_ft: null, ts: new Date().toISOString() })
  }
  return ok(await supabase.from('bedrock_blow_counts').insert(rows).select())
}

export async function deleteBlow(id) {
  return ok(await supabase.from('bedrock_blow_counts').delete().eq('id', id).select())
}

// Fail a pile and create its replacement (B-14 -> B-14R), linked back.
export async function failPile(pile, reason, depthFt) {
  await addEvent(pile.id, 'pile_failed', { reason, depth_ft: depthFt })
  await setPileStatus(pile.id, 'rejected')
  const replacement = {
    job_id: pile.job_id,
    label: pile.label + 'R',
    pile_kind: pile.pile_kind,
    description: pile.description,
    length_ft: pile.length_ft,
    required_tip_elev_ft: pile.required_tip_elev_ft,
    driving_criteria: pile.driving_criteria,
    required_casing_depth_ft: pile.required_casing_depth_ft,
    required_socket_depth_ft: pile.required_socket_depth_ft,
    mix_design_id: pile.mix_design_id,
    replaces_pile_id: pile.id,
    sort_order: (pile.sort_order ?? 0) + 1000,
  }
  return ok(await supabase.from('bedrock_piles').insert(replacement).select().single())
}

export async function addTicket(pileId, fields, photoFile) {
  let photo_path = null
  if (photoFile) {
    const ext = (photoFile.name?.split('.').pop() || 'jpg').toLowerCase()
    photo_path = `${pileId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('bedrock-tickets').upload(photo_path, photoFile)
    if (error) throw new Error('Photo upload failed: ' + error.message)
  }
  return ok(
    await supabase
      .from('bedrock_concrete_tickets')
      .insert({ pile_id: pileId, ts: new Date().toISOString(), photo_path, ...fields })
      .select()
      .single()
  )
}

// Send a ticket photo to our server, which reads it with Claude.
export async function scanTicket(file) {
  const image = await compressToBase64(file)
  const res = await fetch('/api/scan-ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image, media_type: 'image/jpeg' }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Scan failed')
  return data
}

async function compressToBase64(file) {
  const bmp = await createImageBitmap(file)
  const maxDim = 1568
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
  return dataUrl.split(',')[1]
}

export async function updateTicket(pileId, id, fields, photoFile) {
  const patch = { ...fields }
  if (photoFile) {
    const ext = (photoFile.name?.split('.').pop() || 'jpg').toLowerCase()
    const photo_path = `${pileId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('bedrock-tickets').upload(photo_path, photoFile)
    if (error) throw new Error('Photo upload failed: ' + error.message)
    patch.photo_path = photo_path
  }
  return ok(await supabase.from('bedrock_concrete_tickets').update(patch).eq('id', id).select().single())
}

export function ticketPhotoUrl(path) {
  if (!path) return null
  return supabase.storage.from('bedrock-tickets').getPublicUrl(path).data.publicUrl
}

// ---------- derived helpers ----------

// Latest known hole depth for a shaft, from its event stream.
export function currentDepth(events) {
  let d = 0
  for (const e of events) {
    const v = e.data?.end_depth_ft ?? e.data?.start_depth_ft ?? e.data?.depth_ft
    if (typeof v === 'number' && v > d) d = v
  }
  return d
}

export function isDrilling(events) {
  let open = false
  for (const e of events) {
    if (e.event_type === 'drill_start') open = true
    if (e.event_type === 'drill_end') open = false
  }
  return open
}

export function openObstruction(events) {
  let open = null
  for (const e of events) {
    if (e.event_type === 'obstruction_hit') open = e
    if (e.event_type === 'obstruction_cleared') open = null
  }
  return open
}

export function isDriving(events) {
  let open = false
  for (const e of events) {
    if (e.event_type === 'drive_start') open = true
    if (e.event_type === 'drive_end') open = false
  }
  return open
}

export function isPouring(events) {
  let open = false
  for (const e of events) {
    if (e.event_type === 'pour_start') open = true
    if (e.event_type === 'pour_end') open = false
  }
  return open
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10)
}
