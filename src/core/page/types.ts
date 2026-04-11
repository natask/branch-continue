// Page domain types

export type PageStatus = 'active' | 'archived'

export interface PageMeta {
  id: string
  title: string
  createdAt: number
  parentPageId?: string
  status: PageStatus
}

export interface PageView {
  cursorPosition?: number
  scrollTop?: number
}
