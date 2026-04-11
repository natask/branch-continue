// Event store — composable primitives factory

export type { PageEvent, NewPageEvent, EventQueryOpts, EventWriter, EventReader, EventPrimitives } from './types'
export { initEventSchema } from './schema'
export { createWriter } from './writer'
export { createReader } from './reader'

import type { PlatformDatabase } from '../platform/types'
import type { EventPrimitives } from './types'
import { initEventSchema } from './schema'
import { createWriter } from './writer'
import { createReader } from './reader'

export async function createEventPrimitives(db: PlatformDatabase): Promise<EventPrimitives> {
  await initEventSchema(db)
  const writer = createWriter(db)
  const reader = createReader(db)
  return { writer, reader }
}
