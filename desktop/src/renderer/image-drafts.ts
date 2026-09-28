export type Attachment = { id: string; name: string; width: number; height: number }
const pending = new Map<string, Attachment[]>(), listeners = new Set<() => void>(), empty: Attachment[] = []
export const subscribeImages = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify) } }
const notify = () => { for (const listener of listeners) listener() }
export const imageAttachments = (sessionId: string | null) => pending.get(sessionId || 'draft') || empty
export function addImageAttachments(sessionId: string | null, images: Attachment[]) { pending.set(sessionId || 'draft', [...imageAttachments(sessionId), ...images]); notify() }
export function clearImageAttachments(sessionId: string | null, ids: string[]) { pending.set(sessionId || 'draft', imageAttachments(sessionId).filter(item => !ids.includes(item.id))); notify() }
export function resetImageDrafts() { const ids = [...pending.values()].flatMap(images => images.map(image => image.id)); pending.clear(); notify(); return ids }
