// Sidebar — page tree navigation

import type { PageMeta } from '../../core/page/types'

interface SidebarProps {
  pages: PageMeta[]
  activePageId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

function buildTree(pages: PageMeta[]): Map<string | undefined, PageMeta[]> {
  const tree = new Map<string | undefined, PageMeta[]>()
  for (const page of pages) {
    const parent = page.parentPageId
    if (!tree.has(parent)) tree.set(parent, [])
    tree.get(parent)!.push(page)
  }
  return tree
}

function TreeNode({
  page,
  tree,
  activePageId,
  onSelect,
  depth,
}: {
  page: PageMeta
  tree: Map<string | undefined, PageMeta[]>
  activePageId: string | null
  onSelect: (id: string) => void
  depth: number
}) {
  const children = tree.get(page.id) ?? []
  const isActive = page.id === activePageId

  return (
    <div>
      <button
        className={`sidebar-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => onSelect(page.id)}
      >
        {page.title || 'Untitled'}
      </button>
      {children.map((child) => (
        <TreeNode
          key={child.id}
          page={child}
          tree={tree}
          activePageId={activePageId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

export function Sidebar({ pages, activePageId, onSelect, onCreate }: SidebarProps) {
  const tree = buildTree(pages)
  const roots = tree.get(undefined) ?? []

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Pages</span>
        <button className="btn-new" onClick={onCreate}>
          + New
        </button>
      </div>
      <nav className="sidebar-tree">
        {roots.map((page) => (
          <TreeNode
            key={page.id}
            page={page}
            tree={tree}
            activePageId={activePageId}
            onSelect={onSelect}
            depth={0}
          />
        ))}
        {roots.length === 0 && (
          <p className="sidebar-empty">No pages yet. Create one to start.</p>
        )}
      </nav>
    </aside>
  )
}
