'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import * as React from 'react'
import { commandScore } from 'master-cmdk-core'
import type {
  ActionDefinition,
  ActionRegistry,
  ActionRegistrySnapshot,
  ActionRunSnapshot,
} from 'master-cmdk-core'
import { createAbortableDebounce } from './async'
import { Primitive } from '@radix-ui/react-primitive'
import { useId } from '@radix-ui/react-id'
import { composeRefs } from '@radix-ui/react-compose-refs'

type Children = { children?: React.ReactNode }
type DivProps = React.ComponentPropsWithoutRef<typeof Primitive.div>

type LoadingProps = Children &
  DivProps & {
    /** Estimated progress of loading asynchronous options. */
    progress?: number
    /**
     * Accessible label for this loading progressbar. Not shown visibly.
     */
    label?: string
  }

type EmptyProps = Children & DivProps & {}
type SeparatorProps = DivProps & {
  /** Whether this separator should always be rendered. Useful if you disable automatic filtering. */
  alwaysRender?: boolean
}
type DialogProps = RadixDialog.DialogProps &
  CommandProps & {
    /** Accessible title text for the dialog. Rendered in a visually-hidden Dialog title. */
    label?: string
    /** Optional accessible description text for the dialog. Rendered in a visually-hidden Dialog description. */
    description?: string
    /** Provide a className to the Dialog overlay. */
    overlayClassName?: string
    /** Provide a className to the Dialog content. */
    contentClassName?: string
    /** Provide a custom element the Dialog should portal into. */
    container?: HTMLElement
  }
type ListProps = Children &
  DivProps & {
    /**
     * Accessible label for this List of suggestions. Not shown visibly.
     */
    label?: string
    /**
     * Enable simple windowed rendering for large flat lists.
     * Best used with fixed-height rows and external filtering (`shouldFilter={false}`).
     */
    virtualized?: boolean
    /** Estimated row height in px when virtualization is enabled. */
    itemHeight?: number
    /** Number of rows to render above and below the viewport. */
    overscan?: number
  }
type ModeProps = Children &
  DivProps & {
    /** Unique mode id, e.g. "commands", "files", "chat". */
    value: string
    /** Optional scoring override for all items in this mode. */
    filter?: CommandFilter
    /** Optional loading state scoped to this mode. */
    loading?: boolean
    /** Keep the subtree mounted when inactive. Defaults to true. */
    forceMount?: boolean
  }
type ItemProps = Children &
  Omit<DivProps, 'disabled' | 'onSelect' | 'value'> & {
    /** Whether this item is currently disabled. */
    disabled?: boolean
    /** Event handler for when this item is selected, either via click or keyboard selection. */
    onSelect?: (value: string) => void
    /**
     * A unique value for this item.
     * If no value is provided, it will be inferred from `children` or the rendered `textContent`. If your `textContent` changes between renders, you _must_ provide a stable, unique `value`.
     */
    value?: string
    /** Optional keywords to match against when filtering. */
    keywords?: string[]
    /** Whether this item is forcibly rendered regardless of filtering. */
    forceMount?: boolean
  }
type ActionConfirmationRequest<TInput, TOutput> = {
  action: ActionDefinition<TInput, TOutput>
  input: TInput
}
type ActionProps<TInput = unknown, TOutput = unknown> = Children &
  Omit<ItemProps, 'keywords' | 'onError' | 'onSelect' | 'value'> & {
    /** Serializable action data used for search and execution metadata. */
    action: ActionDefinition<TInput, TOutput>
    /** Registry that owns the action executor and run state. */
    registry: ActionRegistry
    /** Input passed to the registered executor when this item is selected. */
    input: TInput
    /** Optional approval callback. Leave unset to keep write actions in the confirming state. */
    confirm?: (request: ActionConfirmationRequest<TInput, TOutput>) => boolean | Promise<boolean>
    /** Called after each run-state transition started by this item. */
    onRun?: (run: ActionRunSnapshot<TInput, TOutput>) => void
    /** Called when registry dispatch or the approval callback throws. */
    onActionError?: (error: unknown) => void
  }
type GroupProps = Children &
  Omit<DivProps, 'heading' | 'value'> & {
    /** Optional heading to render for this group. */
    heading?: React.ReactNode
    /** If no heading is provided, you must provide a value that is unique for this group. */
    value?: string
    /** Optional scoring override for items within this group. */
    filter?: CommandFilter
    /** Whether this group is forcibly rendered regardless of filtering. */
    forceMount?: boolean
  }
type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  /** Optional id override for the underlying input element. */
  inputId?: string
  /** Debounce delay in ms for search updates and onValueChange callbacks. */
  debounce?: number
  /**
   * Optional controlled state for the value of the search input.
   */
  value?: string
  /**
   * Event handler called when the search value changes.
   */
  onValueChange?: (search: string, signal?: AbortSignal) => void
}
type CommandFilter = (value: string, search: string, keywords?: string[]) => number
type CommandProps = Children &
  DivProps & {
    /**
     * Accessible label for this command menu. Not shown visibly.
     */
    label?: string
    /**
     * Optionally set to `false` to turn off the automatic filtering and sorting.
     * If `false`, you must conditionally render valid items based on the search query yourself.
     */
    shouldFilter?: boolean
    /** Whether Command.Loading content should be shown. */
    loading?: boolean
    /**
     * Optional CSP nonce used by dialog style injection internals.
     * Meaningful when using `Command.Dialog`.
     */
    cspNonce?: string
    /**
     * Custom filter function for whether each command menu item should matches the given search query.
     * It should return a number between 0 and 1, with 1 being the best match and 0 being hidden entirely.
     * By default, uses the `command-score` library.
     */
    filter?: CommandFilter
    /**
     * Optional default item value when it is initially rendered.
     */
    defaultValue?: string
    /**
     * Optional uncontrolled initial value for the search input.
     */
    defaultSearch?: string
    /**
     * Optional controlled state of the selected command menu item.
     */
    value?: string
    /**
     * Called when results transition into an empty state while search is non-empty.
     */
    onEmpty?: () => void
    /**
     * Event handler called when the selected item of the menu changes.
     */
    onValueChange?: (value: string) => void
    /**
     * Controlled active mode id. Use with `<Command.Mode value="...">`.
     */
    mode?: string
    /**
     * Uncontrolled initial mode id.
     */
    defaultMode?: string
    /**
     * Called when active mode changes.
     */
    onModeChange?: (mode: string) => void
    /**
     * Selection model. Defaults to `"single"` for cmdk compatibility.
     */
    selectionMode?: 'single' | 'multiple'
    /**
     * Controlled checked values when `selectionMode="multiple"`.
     */
    selectedValues?: string[]
    /**
     * Uncontrolled initial checked values when `selectionMode="multiple"`.
     */
    defaultSelectedValues?: string[]
    /**
     * Called when checked values change in multi-select mode.
     */
    onSelectedValuesChange?: (values: string[]) => void
    /**
     * Optionally set to `true` to turn on looping around when using the arrow keys.
     */
    loop?: boolean
    /**
     * Optionally set to `true` to disable selection via pointer events.
     * @deprecated prefer `pointerBehavior="locked"`.
     */
    disablePointerSelection?: boolean
    /**
     * How pointer and keyboard interact with the selection.
     *
     * - `"fused"` (default, upstream-compatible): pointer and keyboard both
     *   write the single selection. Hovering a row selects it.
     * - `"split"` (Raycast-style): keyboard owns `aria-selected`. Pointer
     *   writes a separate `pointerValue` exposed as `data-pointer-over` on
     *   items. Click reconciles — sets selection to the hovered row and
     *   invokes `onSelect`. Style the two states independently.
     * - `"locked"`: pointer never moves selection. Click still commits.
     *
     * If `disablePointerSelection` is `true` and `pointerBehavior` is unset,
     * behaves as `"locked"` for backward compat.
     */
    pointerBehavior?: 'fused' | 'split' | 'locked'
    /**
     * Set to `false` to disable ctrl+n/j/p/k shortcuts. Defaults to `true`.
     */
    vimBindings?: boolean
  }

type Context = {
  value: (id: string, value: string, keywords?: string[]) => void
  item: (id: string, groupId?: string, modeId?: string, forceMount?: boolean) => () => void
  group: (id: string, filter?: CommandFilter, modeId?: string) => () => void
  mode: (id: string, filter?: CommandFilter, loading?: boolean) => () => void
  filter: () => boolean
  getMode: () => string | undefined
  setMode: (mode: string) => void
  getLoading: () => boolean | undefined
  label: string
  getDisablePointerSelection: () => boolean
  getPointerBehavior: () => 'fused' | 'split' | 'locked'
  getSelectionMode: () => 'single' | 'multiple'
  toggleCheckedValue: (value: string | undefined) => void
  // Ids
  listId: string
  inputId: string
  labelId: string
  // Refs
  listInnerRef: React.RefObject<HTMLDivElement | null>
}
type State = {
  search: string
  value: string
  mode?: string
  selectedValues: Set<string>
  /** Row currently under the pointer in `split` mode. Undefined otherwise. */
  pointerValue?: string
  selectedItemId?: string
  filtered: { count: number; items: Map<string, number>; groups: Set<string> }
}
type Store = {
  subscribe: (callback: () => void) => () => void
  subscribeValue: (value: string | undefined, callback: () => void) => () => void
  subscribeCheckedValue: (value: string | undefined, callback: () => void) => () => void
  subscribePointerValue: (value: string | undefined, callback: () => void) => () => void
  snapshot: () => State
  setState: <K extends keyof State>(key: K, value: State[K], opts?: any) => void
  emit: () => void
}
type Group = {
  id: string
  filter?: CommandFilter
  forceMount?: boolean
  mode?: string
}
type Mode = {
  id: string
}

const GROUP_SELECTOR = `[cmdk-group=""]`
const GROUP_ITEMS_SELECTOR = `[cmdk-group-items=""]`
const GROUP_HEADING_SELECTOR = `[cmdk-group-heading=""]`
const ITEM_SELECTOR = `[cmdk-item=""]`
const VALID_ITEM_SELECTOR = `${ITEM_SELECTOR}:not([aria-disabled="true"])`
const SELECT_EVENT = `cmdk-item-select`
const VALUE_ATTR = `data-value`
const defaultFilter: CommandFilter = (value, search, keywords) => commandScore(value, search, keywords)
const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  borderWidth: 0,
}

const CommandContext = React.createContext<Context>(undefined)
const useCommand = () => React.useContext(CommandContext)
const StoreContext = React.createContext<Store>(undefined)
const useStore = () => React.useContext(StoreContext)
const GroupContext = React.createContext<Group>(undefined)
const ModeContext = React.createContext<Mode>(undefined)

const Command = React.forwardRef<HTMLDivElement, CommandProps>((props, forwardedRef) => {
  const state = useLazyRef<State>(() => ({
    /** Value of the search query. */
    search: props.defaultSearch ?? '',
    /** Currently selected item value. */
    value: props.value ?? props.defaultValue ?? '',
    /** Active mode. */
    mode: props.mode ?? props.defaultMode,
    /** Checked item values in multi-select mode. */
    selectedValues: new Set((props.defaultSelectedValues ?? []).map((entry) => String(entry).trim())),
    /** Currently selected item id. */
    selectedItemId: undefined,
    filtered: {
      /** The count of all visible items. */
      count: 0,
      /** Map from visible item id to its search score. */
      items: new Map(),
      /** Set of groups with at least one visible item. */
      groups: new Set(),
    },
  }))
  const allItems = useLazyRef<Set<string>>(() => new Set()) // [...itemIds]
  const allGroups = useLazyRef<Map<string, Set<string>>>(() => new Map()) // groupId → [...itemIds]
  const modeFilters = useLazyRef<Map<string, CommandFilter | undefined>>(() => new Map()) // modeId → filter
  const modeLoadings = useLazyRef<Map<string, boolean | undefined>>(() => new Map()) // modeId → loading
  const groupFilters = useLazyRef<Map<string, CommandFilter | undefined>>(() => new Map()) // groupId → filter
  const groupToMode = useLazyRef<Map<string, string | undefined>>(() => new Map()) // groupId → modeId
  const itemToGroup = useLazyRef<Map<string, string | undefined>>(() => new Map()) // itemId → groupId
  const itemToMode = useLazyRef<Map<string, string | undefined>>(() => new Map()) // itemId → modeId
  const forceMountItems = useLazyRef<Set<string>>(() => new Set()) // [...force-mounted itemIds]
  const groupsInitialOrder = useLazyRef<string[]>(() => []) // [...groupIds]
  // Source-order interleaving of top-level list children (groups + ungrouped items).
  // Needed so restoreSourceOrder() can put ungrouped items back between groups
  // on search clear, not just at the tail of the list.
  const listInitialOrder = useLazyRef<string[]>(() => []) // [...topLevelIds]
  const ids = useLazyRef<Map<string, { value: string; keywords?: string[] }>>(() => new Map()) // id → { value, keywords }
  const listeners = useLazyRef<Set<() => void>>(() => new Set()) // [...rerenders]
  const valueListeners = useLazyRef<Map<string | undefined, Set<() => void>>>(() => new Map()) // value → [...rerenders]
  const checkedValueListeners = useLazyRef<Map<string | undefined, Set<() => void>>>(() => new Map()) // checked value → [...rerenders]
  const pointerValueListeners = useLazyRef<Map<string | undefined, Set<() => void>>>(() => new Map()) // pointer value → [...rerenders]
  const propsRef = useAsRef(props)
  const {
    label,
    children,
    value,
    onValueChange,
    filter,
    shouldFilter,
    loading,
    cspNonce: _cspNonce,
    defaultSearch: _defaultSearch,
    onEmpty,
    mode,
    onModeChange,
    selectedValues,
    onSelectedValuesChange,
    loop,
    disablePointerSelection = false,
    pointerBehavior: pointerBehaviorProp,
    selectionMode: _selectionMode,
    defaultMode: _defaultMode,
    defaultSelectedValues: _defaultSelectedValues,
    vimBindings = true,
    ...etc
  } = props

  const listId = useId()
  const inputId = useId()
  const labelId = `${inputId}-label`

  const listInnerRef = React.useRef<HTMLDivElement>(null)
  const hasMountedRef = React.useRef(false)

  const schedule = useScheduleLayoutEffect()

  /** Controlled mode `value` handling. */
  useIsomorphicLayoutEffect(() => {
    if (value !== undefined) {
      const previousValue = state.current.value
      const v = value.trim()
      if (Object.is(previousValue, v)) return
      state.current.value = v
      emitValueListeners(previousValue, v)
      store.emit()
    }
  }, [value])

  /** Controlled mode handling. */
  useIsomorphicLayoutEffect(() => {
    if (mode !== undefined) {
      const previousMode = state.current.mode
      if (Object.is(previousMode, mode)) return
      state.current.mode = mode
      filterItems()
      sort()
      if (!isSelectedValueVisible()) {
        selectFirstItem()
      }
      store.emit()
    }
  }, [mode])

  /** Controlled multi-select handling. */
  useIsomorphicLayoutEffect(() => {
    if (selectedValues !== undefined) {
      const nextValues = toTrimmedValueSet(selectedValues)
      const previousValues = state.current.selectedValues
      if (areSetsEqual(previousValues, nextValues)) return
      state.current.selectedValues = nextValues
      emitCheckedValueListeners(previousValues, nextValues)
      store.emit()
    }
  }, [selectedValues])

  const store: Store = React.useMemo(() => {
    return {
      subscribe: (cb) => {
        listeners.current.add(cb)
        return () => listeners.current.delete(cb)
      },
      subscribeValue: (value, cb) => {
        const valueListener = valueListeners.current.get(value)

        if (valueListener) {
          valueListener.add(cb)
        } else {
          valueListeners.current.set(value, new Set([cb]))
        }

        return () => {
          const currentValueListener = valueListeners.current.get(value)
          if (!currentValueListener) return
          currentValueListener.delete(cb)
          if (currentValueListener.size === 0) {
            valueListeners.current.delete(value)
          }
        }
      },
      subscribeCheckedValue: (value, cb) => {
        const checkedValueListener = checkedValueListeners.current.get(value)

        if (checkedValueListener) {
          checkedValueListener.add(cb)
        } else {
          checkedValueListeners.current.set(value, new Set([cb]))
        }

        return () => {
          const currentCheckedValueListener = checkedValueListeners.current.get(value)
          if (!currentCheckedValueListener) return
          currentCheckedValueListener.delete(cb)
          if (currentCheckedValueListener.size === 0) {
            checkedValueListeners.current.delete(value)
          }
        }
      },
      subscribePointerValue: (value, cb) => {
        const listener = pointerValueListeners.current.get(value)
        if (listener) listener.add(cb)
        else pointerValueListeners.current.set(value, new Set([cb]))
        return () => {
          const current = pointerValueListeners.current.get(value)
          if (!current) return
          current.delete(cb)
          if (current.size === 0) pointerValueListeners.current.delete(value)
        }
      },
      snapshot: () => {
        return state.current
      },
      setState: (key, value, opts) => {
        const previousValue = key === 'value' ? state.current.value : undefined
        const previousCheckedValues = key === 'selectedValues' ? state.current.selectedValues : undefined
        const previousPointerValue = key === 'pointerValue' ? state.current.pointerValue : undefined
        if (Object.is(state.current[key], value)) return
        state.current[key] = value

        if (key === 'pointerValue') {
          // Pointer-over is an aesthetic state: no filter, no focus, no selection.
          // Notify only items whose hover attribute flipped.
          emitPointerValueListeners(previousPointerValue, value as string | undefined)
          return
        }

        if (key === 'selectedValues') {
          const nextCheckedValues = value as Set<string>
          emitCheckedValueListeners(previousCheckedValues, nextCheckedValues)
          propsRef.current.onSelectedValuesChange?.(Array.from(nextCheckedValues))
          if (propsRef.current.selectedValues !== undefined) {
            return
          }
          store.emit()
          return
        }

        if (key === 'search') {
          // Query changes mean the user is still searching: re-rank and snap
          // selection to the top visible result for the current query.
          filterItems()
          sort()
          schedule(1, selectFirstItem)
        } else if (key === 'mode') {
          filterItems()
          sort()
          if (!isSelectedValueVisible()) {
            selectFirstItem()
          }
          const nextMode = (value ?? '') as string
          propsRef.current.onModeChange?.(nextMode)

          if (propsRef.current.mode !== undefined) {
            return
          }
        } else if (key === 'value') {
          emitValueListeners(previousValue, value as string | undefined)

          // Force focus input or root so accessibility works
          if (document.activeElement.hasAttribute('cmdk-input') || document.activeElement.hasAttribute('cmdk-root')) {
            const input = document.getElementById(inputId)
            if (input) input.focus()
            else document.getElementById(listId)?.focus()
          }

          schedule(7, () => {
            state.current.selectedItemId = getSelectedItem()?.id
            store.emit()
          })

          if (propsRef.current?.value !== undefined) {
            // If controlled, just call the callback instead of updating state internally
            const newValue = (value ?? '') as string
            propsRef.current.onValueChange?.(newValue)
            return
          }

          store.emit()
          return
        }

        // Notify global subscribers for non-value updates.
        store.emit()
      },
      emit: () => {
        listeners.current.forEach((l) => l())
      },
    }
  }, [])
  const selectedValue = React.useSyncExternalStore(
    store.subscribe,
    () => state.current.value,
    () => state.current.value,
  )
  const activeMode = React.useSyncExternalStore(
    store.subscribe,
    () => state.current.mode,
    () => state.current.mode,
  )
  const isFilteredEmpty = React.useSyncExternalStore(
    store.subscribe,
    () => state.current.search !== '' && state.current.filtered.count === 0,
    () => state.current.search !== '' && state.current.filtered.count === 0,
  )
  const hasMountedEmptyRef = React.useRef(false)
  const wasFilteredEmptyRef = React.useRef(isFilteredEmpty)

  useIsomorphicLayoutEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }

    scrollSelectedIntoView()
  }, [selectedValue])

  useIsomorphicLayoutEffect(() => {
    if (!state.current.search) return
    filterItems()
    sort()
    selectFirstItem()
    store.emit()
  }, [filter, shouldFilter, activeMode])

  React.useEffect(() => {
    if (!state.current.value) {
      selectFirstItem()
    }
  }, [])

  useIsomorphicLayoutEffect(() => {
    if (!hasMountedEmptyRef.current) {
      hasMountedEmptyRef.current = true
      wasFilteredEmptyRef.current = isFilteredEmpty
      return
    }

    if (isFilteredEmpty && !wasFilteredEmptyRef.current) {
      propsRef.current.onEmpty?.()
    }

    wasFilteredEmptyRef.current = isFilteredEmpty
  }, [isFilteredEmpty])

  const context: Context = React.useMemo(
    () => ({
      // Keep id → {value, keywords} mapping up-to-date
      value: (id, value, keywords) => {
        if (value !== ids.current.get(id)?.value) {
          ids.current.set(id, { value, keywords })
          state.current.filtered.items.set(id, score(value, keywords))
          schedule(2, () => {
            sort()
            if (!state.current.value) {
              selectFirstItem()
            }
            store.emit()
          })
        }
      },
      // Track item lifecycle (mount, unmount)
      item: (id, groupId, modeId, forceMount) => {
        allItems.current.add(id)
        itemToGroup.current.set(id, groupId)
        itemToMode.current.set(id, modeId)
        if (forceMount) forceMountItems.current.add(id)
        else forceMountItems.current.delete(id)

        // Track this item within the group
        if (groupId) {
          if (!allGroups.current.has(groupId)) {
            allGroups.current.set(groupId, new Set([id]))
          } else {
            allGroups.current.get(groupId).add(id)
          }
        } else if (!listInitialOrder.current.includes(id)) {
          listInitialOrder.current.push(id)
        }

        // Batch this, multiple items can mount in one pass
        // and we should not be filtering/sorting/emitting each time
        schedule(3, () => {
          filterItems()
          sort()

          // Could be initial mount, select the first item if none already selected
          if (!state.current.value) {
            selectFirstItem()
          }

          store.emit()
        })

        return () => {
          ids.current.delete(id)
          allItems.current.delete(id)
          itemToGroup.current.delete(id)
          itemToMode.current.delete(id)
          forceMountItems.current.delete(id)
          state.current.filtered.items.delete(id)
          const topIdx = listInitialOrder.current.indexOf(id)
          if (topIdx !== -1) listInitialOrder.current.splice(topIdx, 1)
          const selectedItem = getSelectedItem()

          // Batch this, multiple items could be removed in one pass
          schedule(4, () => {
            filterItems()

            // The item removed have been the selected one,
            // so selection should be moved to the first
            if (selectedItem?.getAttribute('id') === id) selectFirstItem()

            store.emit()
          })
        }
      },
      // Track group lifecycle (mount, unmount)
      group: (id, filter, modeId) => {
        if (!allGroups.current.has(id)) {
          allGroups.current.set(id, new Set())
        }
        groupFilters.current.set(id, filter)
        groupToMode.current.set(id, modeId)
        if (!groupsInitialOrder.current.includes(id)) {
          groupsInitialOrder.current.push(id)
        }
        if (!listInitialOrder.current.includes(id)) {
          listInitialOrder.current.push(id)
        }

        return () => {
          ids.current.delete(id)
          allGroups.current.delete(id)
          groupFilters.current.delete(id)
          groupToMode.current.delete(id)
          const index = groupsInitialOrder.current.indexOf(id)
          if (index !== -1) groupsInitialOrder.current.splice(index, 1)
          const topIdx = listInitialOrder.current.indexOf(id)
          if (topIdx !== -1) listInitialOrder.current.splice(topIdx, 1)
        }
      },
      // Track mode lifecycle (mount, unmount)
      mode: (id, filter, loading) => {
        modeFilters.current.set(id, filter)
        modeLoadings.current.set(id, loading)
        schedule(5, () => {
          if (state.current.mode === undefined) {
            store.setState('mode', id)
          }
        })

        return () => {
          modeFilters.current.delete(id)
          modeLoadings.current.delete(id)
          if (state.current.mode === id) {
            const fallback = modeFilters.current.keys().next().value as string | undefined
            store.setState('mode', fallback)
          }
        }
      },
      filter: () => {
        return propsRef.current.shouldFilter
      },
      getMode: () => {
        return state.current.mode
      },
      setMode: (nextMode) => {
        store.setState('mode', nextMode)
      },
      getLoading: () => {
        if (propsRef.current.loading !== undefined) {
          return propsRef.current.loading
        }
        if (!state.current.mode) {
          return undefined
        }
        return modeLoadings.current.get(state.current.mode)
      },
      label: label || props['aria-label'] || 'Command Menu',
      getDisablePointerSelection: () => {
        return propsRef.current.disablePointerSelection
      },
      getPointerBehavior: () => {
        const explicit = propsRef.current.pointerBehavior
        if (explicit) return explicit
        return propsRef.current.disablePointerSelection ? 'locked' : 'fused'
      },
      getSelectionMode: () => {
        return propsRef.current.selectionMode ?? 'single'
      },
      toggleCheckedValue: (checkedValue) => {
        if (checkedValue === undefined) return
        if ((propsRef.current.selectionMode ?? 'single') !== 'multiple') return

        const nextValues = new Set(state.current.selectedValues)
        if (nextValues.has(checkedValue)) nextValues.delete(checkedValue)
        else nextValues.add(checkedValue)

        store.setState('selectedValues', nextValues)
      },
      listId,
      inputId,
      labelId,
      listInnerRef,
    }),
    [],
  )

  function score(value: string, keywords?: string[], groupFilter?: CommandFilter, modeFilter?: CommandFilter) {
    const filter = groupFilter ?? modeFilter ?? propsRef.current?.filter ?? defaultFilter
    return value ? filter(value, state.current.search, keywords) : 0
  }

  function emitValueListeners(previousValue: string | undefined, nextValue: string | undefined) {
    const fns = new Set<() => void>()

    valueListeners.current.get(previousValue)?.forEach((fn) => fns.add(fn))
    valueListeners.current.get(nextValue)?.forEach((fn) => fns.add(fn))

    fns.forEach((fn) => fn())
  }

  function emitPointerValueListeners(previousValue: string | undefined, nextValue: string | undefined) {
    const fns = new Set<() => void>()
    pointerValueListeners.current.get(previousValue)?.forEach((fn) => fns.add(fn))
    pointerValueListeners.current.get(nextValue)?.forEach((fn) => fns.add(fn))
    fns.forEach((fn) => fn())
  }

  function emitCheckedValueListeners(previousValues?: Set<string>, nextValues?: Set<string>) {
    const changedValues = new Set<string | undefined>()

    previousValues?.forEach((value) => {
      if (!nextValues?.has(value)) changedValues.add(value)
    })
    nextValues?.forEach((value) => {
      if (!previousValues?.has(value)) changedValues.add(value)
    })

    const listenersToNotify = new Set<() => void>()
    changedValues.forEach((value) => {
      checkedValueListeners.current.get(value)?.forEach((listener) => listenersToNotify.add(listener))
    })

    listenersToNotify.forEach((listener) => listener())
  }

  function isModeVisible(modeId: string | undefined, active: string | undefined = state.current.mode) {
    if (!modeId || !active) return true
    return modeId === active
  }

  /**
   * Snaps group and item DOM order back to source-registration order.
   * Fixes upstream cmdk #264 / #375: after a search clears, items that
   * re-mount land wherever React's reconciler inserts them relative to the
   * prior score-sorted DOM. We iterate the registration-ordered refs and
   * re-append each node into its proper parent. `listInitialOrder` preserves
   * the interleaving of ungrouped items with groups at the list top level.
   */
  function restoreSourceOrder() {
    const listSizer = listInnerRef.current
    if (!listSizer) return
    for (const topId of listInitialOrder.current) {
      if (!topId) continue
      const node = listSizer.querySelector<HTMLElement>(`#${CSS.escape(topId)}`)
      if (!node || node.parentElement !== listSizer) continue
      listSizer.appendChild(node)
    }
    for (const groupId of groupsInitialOrder.current) {
      if (!groupId) continue
      const items = allGroups.current.get(groupId)
      if (!items || items.size === 0) continue
      const groupItems = listSizer.querySelector<HTMLElement>(
        `#${CSS.escape(groupId)} ${GROUP_ITEMS_SELECTOR}`,
      )
      if (!groupItems) continue
      for (const itemId of items) {
        if (!itemId) continue
        const item = listSizer.querySelector<HTMLElement>(`#${CSS.escape(itemId)}`)
        if (!item || item.parentElement !== groupItems) continue
        groupItems.appendChild(item)
      }
    }
  }

  /** Sorts items by score, and groups by highest item score. */
  function sort() {
    // Explicitly false, because true | undefined is the default
    if (propsRef.current.shouldFilter === false) {
      return
    }

    if (!state.current.search) {
      // Restore runs twice: once synchronously for already-mounted nodes, then
      // again after React re-mounts items that were hidden during search so
      // their remount insertion points don't leave the DOM scrambled.
      restoreSourceOrder()
      schedule(9, restoreSourceOrder)
      state.current.filtered.groups = new Set()
      return
    }

    const scores = state.current.filtered.items

    // Sort the groups
    const groups: [string, number][] = []
    state.current.filtered.groups.forEach((value) => {
      const items = allGroups.current.get(value)
      if (!isModeVisible(groupToMode.current.get(value))) {
        return
      }

      // Get the maximum score of the group's items
      let max = 0
      items.forEach((item) => {
        const score = scores.get(item)
        max = Math.max(score, max)
      })

      groups.push([value, max])
    })

    // Sort items within groups to bottom
    // Sort items outside of groups
    // Sort groups to bottom (pushes all non-grouped items to the top)
    const listInsertionElement = listInnerRef.current

    // Sort the items
    getValidItems()
      .sort((a, b) => {
        const valueA = a.getAttribute('id')
        const valueB = b.getAttribute('id')
        return (scores.get(valueB) ?? 0) - (scores.get(valueA) ?? 0)
      })
      .forEach((item) => {
        const group = item.closest(GROUP_ITEMS_SELECTOR)

        if (group) {
          group.appendChild(item.parentElement === group ? item : item.closest(`${GROUP_ITEMS_SELECTOR} > *`))
        } else {
          listInsertionElement.appendChild(
            item.parentElement === listInsertionElement ? item : item.closest(`${GROUP_ITEMS_SELECTOR} > *`),
          )
        }
      })

    groups
      .sort((a, b) => b[1] - a[1])
      .forEach((group) => {
        if (!group[0]) return
        const element = listInnerRef.current?.querySelector(`#${CSS.escape(group[0])}`)
        element?.parentElement.appendChild(element)
      })
  }

  function selectFirstItem() {
    const item = getValidItems().find((item) => item.getAttribute('aria-disabled') !== 'true')
    store.setState('value', getItemValue(item))
  }

  function isSelectedValueVisible() {
    const activeMode = state.current.mode
    for (const id of allItems.current) {
      if (ids.current.get(id)?.value !== state.current.value) continue
      const modeId = itemToMode.current.get(id)
      if (!isModeVisible(modeId, activeMode)) continue
      if (forceMountItems.current.has(id)) return true
      if (propsRef.current.shouldFilter === false || !state.current.search) return true
      if ((state.current.filtered.items.get(id) ?? 0) > 0) return true
    }
    return false
  }

  /** Filters the current items. */
  function filterItems() {
    const activeMode = state.current.mode

    if (
      !state.current.search ||
      // Explicitly false, because true | undefined is the default
      propsRef.current.shouldFilter === false
    ) {
      let count = 0
      for (const id of allItems.current) {
        if (isModeVisible(itemToMode.current.get(id), activeMode)) {
          count++
        }
      }
      state.current.filtered.count = count
      // Do nothing, each item will know to show itself because search is empty
      return
    }

    // Reset the groups
    state.current.filtered.groups = new Set()
    let itemCount = 0

    // Check which items should be included
    for (const id of allItems.current) {
      const value = ids.current.get(id)?.value ?? ''
      const keywords = ids.current.get(id)?.keywords ?? []
      const groupId = itemToGroup.current.get(id)
      const groupFilter = groupId ? groupFilters.current.get(groupId) : undefined
      const modeId = itemToMode.current.get(id)
      const modeFilter = modeId ? modeFilters.current.get(modeId) : undefined
      const visibleByMode = isModeVisible(modeId, activeMode)
      const rank = visibleByMode ? score(value, keywords, groupFilter, modeFilter) : 0
      state.current.filtered.items.set(id, rank)
      if (visibleByMode && (rank > 0 || forceMountItems.current.has(id))) itemCount++
    }

    // Check which groups have at least 1 item shown
    for (const [groupId, group] of allGroups.current) {
      if (!isModeVisible(groupToMode.current.get(groupId), activeMode)) {
        continue
      }
      for (const itemId of group) {
        if (state.current.filtered.items.get(itemId) > 0) {
          state.current.filtered.groups.add(groupId)
          break
        }
      }
    }

    state.current.filtered.count = itemCount
  }

  function scrollSelectedIntoView() {
    const item = getSelectedItem() as HTMLElement | null
    if (!item) return

    // Walk up from the item to find the actual scrollable clipping viewport.
    // Usually this is [cmdk-list], but consumers may wrap List in their own
    // overflow container. If none is found, fall back to unconditional scroll.
    const scrollContainer = findScrollableAncestor(item)

    if (scrollContainer) {
      const itemRect = item.getBoundingClientRect()
      const listRect = scrollContainer.getBoundingClientRect()
      const isAbove = itemRect.top < listRect.top
      const isBelow = itemRect.bottom > listRect.bottom
      if (!isAbove && !isBelow) return
    }

    if (item.parentElement?.firstChild === item) {
      // First item in Group, ensure heading is in view.
      item.closest(GROUP_SELECTOR)?.querySelector(GROUP_HEADING_SELECTOR)?.scrollIntoView({ block: 'nearest' })
    }

    // Ensure the item is in view. block:'nearest' is a no-op if already visible,
    // so this is safe when the pre-check didn't find a clipping ancestor.
    item.scrollIntoView({ block: 'nearest' })
  }

  /** Getters */

  function getSelectedItem() {
    return listInnerRef.current?.querySelector(`${ITEM_SELECTOR}[aria-selected="true"]`)
  }

  function getValidItems() {
    return Array.from(listInnerRef.current?.querySelectorAll(VALID_ITEM_SELECTOR) || [])
  }

  /** Setters */

  function updateSelectedToIndex(index: number) {
    const items = getValidItems()
    const item = items[index]
    if (item) store.setState('value', getItemValue(item))
  }

  function updateSelectedByItem(change: 1 | -1) {
    const selected = getSelectedItem()
    const items = getValidItems()
    const index = items.findIndex((item) => item === selected)

    // Get item at this index
    let newSelected = items[index + change]

    if (propsRef.current?.loop) {
      newSelected =
        index + change < 0
          ? items[items.length - 1]
          : index + change === items.length
          ? items[0]
          : items[index + change]
    }

    if (newSelected) store.setState('value', getItemValue(newSelected))
  }

  function updateSelectedByGroup(change: 1 | -1) {
    const selected = getSelectedItem()
    let group = selected?.closest(GROUP_SELECTOR)
    let item: HTMLElement

    while (group && !item) {
      group = change > 0 ? findNextSibling(group, GROUP_SELECTOR) : findPreviousSibling(group, GROUP_SELECTOR)
      item = group?.querySelector(VALID_ITEM_SELECTOR)
    }

    if (item) {
      store.setState('value', getItemValue(item))
    } else {
      updateSelectedByItem(change)
    }
  }

  function getItemValue(item?: Element | null) {
    if (!item) return undefined

    const fromAttr = item.getAttribute(VALUE_ATTR)
    if (fromAttr !== null) return fromAttr

    const fromMap = item.getAttribute('id') ? ids.current.get(item.getAttribute('id'))?.value : undefined
    if (fromMap !== undefined) return fromMap

    const fromText = item.textContent?.trim()
    return fromText || undefined
  }

  const last = () => updateSelectedToIndex(getValidItems().length - 1)

  const next = (e: React.KeyboardEvent) => {
    e.preventDefault()

    if (e.metaKey) {
      // Last item
      last()
    } else if (e.altKey) {
      // Next group
      updateSelectedByGroup(1)
    } else {
      // Next item
      updateSelectedByItem(1)
    }
  }

  const prev = (e: React.KeyboardEvent) => {
    e.preventDefault()

    if (e.metaKey) {
      // First item
      updateSelectedToIndex(0)
    } else if (e.altKey) {
      // Previous group
      updateSelectedByGroup(-1)
    } else {
      // Previous item
      updateSelectedByItem(-1)
    }
  }

  return (
    <Primitive.div
      ref={forwardedRef}
      tabIndex={-1}
      {...etc}
      cmdk-root=""
      onKeyDown={(e) => {
        etc.onKeyDown?.(e)

        // Check if IME composition is finished before triggering key binds
        // This prevents unwanted triggering while user is still inputting text with IME
        // e.keyCode === 229 is for the CJK IME with Legacy Browser [https://w3c.github.io/uievents/#determine-keydown-keyup-keyCode]
        // isComposing is for the CJK IME with Modern Browser [https://developer.mozilla.org/en-US/docs/Web/API/CompositionEvent/isComposing]
        const isComposing = e.nativeEvent.isComposing || e.keyCode === 229

        if (e.defaultPrevented || isComposing) {
          return
        }

        switch (e.key) {
          case 'n':
          case 'j': {
            // vim keybind down
            if (vimBindings && e.ctrlKey) {
              next(e)
            }
            break
          }
          case 'ArrowDown': {
            next(e)
            break
          }
          case 'p':
          case 'k': {
            // vim keybind up
            if (vimBindings && e.ctrlKey) {
              prev(e)
            }
            break
          }
          case 'ArrowUp': {
            prev(e)
            break
          }
          case 'Home': {
            // First item
            e.preventDefault()
            updateSelectedToIndex(0)
            break
          }
          case 'End': {
            // Last item
            e.preventDefault()
            last()
            break
          }
          case 'Enter': {
            // Trigger item onSelect
            e.preventDefault()
            const item = getSelectedItem()
            if (item) {
              const event = new Event(SELECT_EVENT)
              item.dispatchEvent(event)
            }
          }
        }
      }}
    >
      <label cmdk-label="" id={labelId} style={visuallyHiddenStyle}>
        {context.label}
      </label>
      {SlottableWithNestedChildren(props, (child) => (
        <StoreContext.Provider value={store}>
          <CommandContext.Provider value={context}>{child}</CommandContext.Provider>
        </StoreContext.Provider>
      ))}
    </Primitive.div>
  )
})

/**
 * Command menu item. Becomes active on pointer enter or through keyboard navigation.
 * Preferably pass a `value`, otherwise the value will be inferred from `children` or
 * the rendered item's `textContent`.
 */
const Item = React.forwardRef<HTMLDivElement, ItemProps>((props, forwardedRef) => {
  const id = useId()
  const ref = React.useRef<HTMLDivElement>(null)
  const groupContext = React.useContext(GroupContext)
  const modeContext = React.useContext(ModeContext)
  const context = useCommand()
  const propsRef = useAsRef(props)
  const forceMount = propsRef.current?.forceMount ?? groupContext?.forceMount
  const modeId = groupContext?.mode ?? modeContext?.id

  useIsomorphicLayoutEffect(() => {
    return context.item(id, groupContext?.id, modeId, forceMount)
  }, [forceMount, modeId])

  const value = useValue(id, ref, [props.value, props.children, ref], props.keywords)

  const store = useStore()
  const selectionMode = useCmdk(() => context.getSelectionMode())
  const selected = useCmdk((state) => Boolean(state.value && state.value === value.current))
  const checked = useCmdk((state) => value.current !== undefined && state.selectedValues.has(value.current))
  // pointerValue emits only targeted listeners (no global store.emit), so we
  // must subscribe via useValuePointerOver — useCmdk would never re-run.
  const pointerOver = useValuePointerOver(value)
  const render = useCmdk((state) => {
    const visibleByMode = !modeId || !state.mode ? true : modeId === state.mode
    if (!visibleByMode) return false
    if (forceMount) return true
    if (context.filter() === false) return true
    if (!state.search) return true
    return state.filtered.items.get(id) > 0
  })

  React.useEffect(() => {
    const element = ref.current
    if (!element || props.disabled) return
    element.addEventListener(SELECT_EVENT, onSelect)
    return () => element.removeEventListener(SELECT_EVENT, onSelect)
  }, [render, props.onSelect, props.disabled])

  function onSelect() {
    select()
    context.toggleCheckedValue(value.current)
    propsRef.current.onSelect?.(value.current)
  }

  function select() {
    store.setState('value', value.current, true)
  }

  function onPointerMove() {
    if (props.disabled) return
    const mode = context.getPointerBehavior()
    if (mode === 'locked') return
    if (mode === 'split') {
      store.setState('pointerValue', value.current)
      return
    }
    // fused (default, upstream-compatible): pointer writes selection
    select()
  }

  function onPointerLeave() {
    if (context.getPointerBehavior() !== 'split') return
    if (store.snapshot().pointerValue === value.current) {
      store.setState('pointerValue', undefined)
    }
  }

  function onClick() {
    if (props.disabled) return
    // In split mode, clicking reconciles: the pointer's row wins.
    // select()/onSelect() handles the value write regardless of mode.
    onSelect()
  }

  if (!render) return null

  const { disabled, value: _, onSelect: __, forceMount: ___, keywords: ____, ...etc } = props

  return (
    <Primitive.div
      ref={composeRefs(ref, forwardedRef)}
      {...etc}
      id={id}
      cmdk-item=""
      role="option"
      aria-disabled={Boolean(disabled)}
      aria-selected={Boolean(selected)}
      aria-checked={selectionMode === 'multiple' ? Boolean(checked) : undefined}
      data-disabled={Boolean(disabled)}
      data-selected={Boolean(selected)}
      data-checked={selectionMode === 'multiple' ? Boolean(checked) : undefined}
      data-pointer-over={pointerOver ? true : undefined}
      onPointerMove={disabled ? undefined : onPointerMove}
      onPointerLeave={disabled ? undefined : onPointerLeave}
      onClick={disabled ? undefined : onClick}
    >
      {props.children}
    </Primitive.div>
  )
})

const ActionImpl = React.forwardRef<HTMLDivElement, ActionProps>((props, forwardedRef) => {
  const {
    action,
    registry,
    input,
    confirm,
    onRun,
    onActionError,
    disabled,
    children,
    ...itemProps
  } = props
  const run = useActionRun(registry, action.id)
  const busy = run.status === 'authorizing' || run.status === 'running'

  async function executeAction() {
    try {
      let nextRun = await registry.execute(action.id, input)
      onRun?.(nextRun)

      if (nextRun.status !== 'confirming' || !confirm) return

      const approved = await confirm({ action, input })
      if (!approved) {
        registry.reset(action.id)
        onRun?.(registry.getRun(action.id))
        return
      }

      nextRun = await registry.execute(action.id, input, { confirmed: true })
      onRun?.(nextRun)
    } catch (error) {
      if (onActionError) onActionError(error)
      else console.error('[master-cmdk] action execution failed', error)
    }
  }

  return (
    <Item
      ref={forwardedRef}
      {...itemProps}
      value={action.id}
      keywords={[action.title, ...(action.keywords ?? [])]}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      data-action-id={action.id}
      data-action-authority={action.authority.access}
      data-action-status={run.status}
      onSelect={() => void executeAction()}
    >
      {children ?? action.title}
    </Item>
  )
})

const Action = ActionImpl as <TInput = unknown, TOutput = unknown>(
  props: ActionProps<TInput, TOutput> & React.RefAttributes<HTMLDivElement>,
) => React.ReactElement | null

/**
 * Group command menu items together with a heading.
 * Grouped items are always shown together.
 */
const Group = React.forwardRef<HTMLDivElement, GroupProps>((props, forwardedRef) => {
  const { heading, children, forceMount, filter: groupFilter, id: groupId, ...etc } = props
  const internalId = useId()
  const id = groupId || internalId
  const ref = React.useRef<HTMLDivElement>(null)
  const headingRef = React.useRef<HTMLDivElement>(null)
  const headingId = useId()
  const modeContext = React.useContext(ModeContext)
  const modeId = modeContext?.id
  const context = useCommand()
  const render = useCmdk((state) => {
    const visibleByMode = !modeId || !state.mode ? true : modeId === state.mode
    if (!visibleByMode) return false
    if (forceMount) return true
    if (context.filter() === false) return true
    if (!state.search) return true
    return state.filtered.groups.has(id)
  })

  useIsomorphicLayoutEffect(() => {
    return context.group(id, groupFilter, modeId)
  }, [id, modeId, groupFilter])

  useValue(id, ref, [props.value, props.heading, headingRef])

  const contextValue = React.useMemo(
    () => ({ id, forceMount, filter: groupFilter, mode: modeId }),
    [id, forceMount, groupFilter, modeId],
  )

  return (
    <Primitive.div
      ref={composeRefs(ref, forwardedRef)}
      {...etc}
      id={id}
      cmdk-group=""
      role="presentation"
      hidden={render ? undefined : true}
    >
      {heading && (
        <div ref={headingRef} cmdk-group-heading="" aria-hidden id={headingId}>
          {heading}
        </div>
      )}
      {SlottableWithNestedChildren(props, (child) => (
        <div cmdk-group-items="" role="group" aria-labelledby={heading ? headingId : undefined}>
          <GroupContext.Provider value={contextValue}>{child}</GroupContext.Provider>
        </div>
      ))}
    </Primitive.div>
  )
})

/**
 * Scopes child items/groups to a named mode.
 * Inactive modes stay mounted by default and are hidden.
 */
const Mode = React.forwardRef<HTMLDivElement, ModeProps>((props, forwardedRef) => {
  const { value, children, filter, loading, forceMount = true, ...etc } = props
  const ref = React.useRef<HTMLDivElement>(null)
  const context = useCommand()
  const active = useCmdk((state) => (!state.mode ? true : state.mode === value))

  useIsomorphicLayoutEffect(() => {
    return context.mode(value, filter, loading)
  }, [value, filter, loading])

  const modeValue = React.useMemo(() => ({ id: value }), [value])

  if (!forceMount && !active) return null

  return (
    <Primitive.div
      ref={composeRefs(ref, forwardedRef)}
      {...etc}
      cmdk-mode=""
      data-value={value}
      hidden={active ? undefined : true}
    >
      <ModeContext.Provider value={modeValue}>{children}</ModeContext.Provider>
    </Primitive.div>
  )
})

/**
 * A visual and semantic separator between items or groups.
 * Visible when the search query is empty or `alwaysRender` is true, hidden otherwise.
 */
const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>((props, forwardedRef) => {
  const { alwaysRender, ...etc } = props
  const ref = React.useRef<HTMLDivElement>(null)
  const render = useCmdk((state) => !state.search)

  if (!alwaysRender && !render) return null
  return <Primitive.div ref={composeRefs(ref, forwardedRef)} {...etc} cmdk-separator="" role="separator" />
})

/**
 * Command menu input.
 * All props are forwarded to the underyling `input` element.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>((props, forwardedRef) => {
  const {
    onValueChange,
    debounce = 0,
    type = 'text',
    inputId,
    id,
    onCompositionStart: onCompositionStartProp,
    onCompositionEnd: onCompositionEndProp,
    'aria-label': ariaLabel,
    ...etc
  } = props
  const isControlled = props.value != null
  const store = useStore()
  const search = useCmdk((state) => state.search)
  const selectedItemId = useCmdk((state) => state.selectedItemId)
  const context = useCommand()
  const dispatchRef = React.useRef<(value: string, signal: AbortSignal) => void>(() => undefined)
  const debounceRef = React.useRef<ReturnType<typeof createAbortableDebounce>>()
  const isComposingRef = React.useRef(false)
  const compositionValueRef = React.useRef<string>()
  // Tracks the most recent value this input itself emitted. External store
  // updates — including ones from a sibling Input, imperative store mutation,
  // or a controlled→uncontrolled transition — differ from this ref and must
  // re-sync displayValue.
  const lastLocalValueRef = React.useRef<string>(search)
  const [isComposing, setIsComposing] = React.useState(false)
  const [compositionValue, setCompositionValue] = React.useState<string>()
  // Always render from local display state so typing echoes immediately,
  // even when `value` is externally controlled and debounced.
  const [displayValue, setDisplayValue] = React.useState<string>(props.value ?? search)
  const debounceDelay = Math.max(0, debounce)

  dispatchRef.current = (value, signal) => {
    lastLocalValueRef.current = value
    if (!isControlled) {
      store.setState('search', value)
    }

    onValueChange?.(value, signal)
  }

  useIsomorphicLayoutEffect(() => {
    debounceRef.current?.cancel()
    debounceRef.current = createAbortableDebounce(debounceDelay, (value, signal) => dispatchRef.current(value, signal))
    return () => {
      debounceRef.current?.cancel()
    }
  }, [debounceDelay])

  React.useEffect(() => {
    if (props.value != null) {
      store.setState('search', props.value)
    }
  }, [props.value])

  // In controlled mode, treat props.value as the source of truth that
  // synchronizes local display state (programmatic reset, transformed value,
  // sibling input changes, etc). Skip while composing to avoid IME clobber.
  React.useEffect(() => {
    if (!isControlled || isComposingRef.current) return
    const nextValue = props.value ?? ''
    lastLocalValueRef.current = nextValue
    setDisplayValue(nextValue)
  }, [isControlled, props.value])

  // Sync displayValue ← search when an external source changed the store.
  // "External" = anything that isn't this input's most recent local dispatch.
  // Skipped during composition so the IME's intermediate buffer isn't clobbered.
  React.useEffect(() => {
    if (isControlled || isComposingRef.current) return
    if (lastLocalValueRef.current === search) return
    lastLocalValueRef.current = search
    setDisplayValue(search)
  }, [search, isControlled])

  const inputValue = isComposing ? compositionValue ?? displayValue : displayValue

  return (
    <Primitive.input
      ref={forwardedRef}
      {...etc}
      cmdk-input=""
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      aria-autocomplete="list"
      role="combobox"
      aria-expanded={true}
      aria-controls={context.listId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : context.labelId}
      aria-activedescendant={selectedItemId}
      id={inputId ?? id ?? context.inputId}
      type={type}
      value={inputValue}
      onChange={(e) => {
        const nativeEvent = e.nativeEvent as InputEvent & { isComposing?: boolean }
        if (isComposingRef.current || nativeEvent.isComposing) {
          compositionValueRef.current = e.target.value
          setCompositionValue(e.target.value)
          return
        }

        lastLocalValueRef.current = e.target.value
        setDisplayValue(e.target.value)
        debounceRef.current?.queue(e.target.value)
      }}
      onCompositionStart={(e) => {
        isComposingRef.current = true
        setIsComposing(true)
        compositionValueRef.current = e.currentTarget.value
        setCompositionValue(e.currentTarget.value)
        debounceRef.current?.cancel()
        onCompositionStartProp?.(e)
      }}
      onCompositionEnd={(e) => {
        isComposingRef.current = false
        setIsComposing(false)
        const value = compositionValueRef.current ?? e.currentTarget.value
        compositionValueRef.current = undefined
        setCompositionValue(undefined)
        lastLocalValueRef.current = value
        setDisplayValue(value)
        debounceRef.current?.queue(value)
        onCompositionEndProp?.(e)
      }}
    />
  )
})

/**
 * Contains `Item`, `Group`, and `Separator`.
 * Use the `--cmdk-list-height` CSS variable to animate height based on the number of results.
 */
const List = React.forwardRef<HTMLDivElement, ListProps>((props, forwardedRef) => {
  const { children, label = 'Suggestions', virtualized = false, itemHeight = 36, overscan = 6, ...etc } = props
  const ref = React.useRef<HTMLDivElement>(null)
  const height = React.useRef<HTMLDivElement>(null)
  const selectedItemId = useCmdk((state) => state.selectedItemId)
  const search = useCmdk((state) => state.search)
  const mode = useCmdk((state) => state.mode)
  const context = useCommand()

  React.useEffect(() => {
    if (height.current && ref.current) {
      const el = height.current
      const wrapper = ref.current
      let animationFrame
      const observer = new ResizeObserver(() => {
        animationFrame = requestAnimationFrame(() => {
          const height = el.offsetHeight
          wrapper.style.setProperty(`--cmdk-list-height`, height.toFixed(1) + 'px')
        })
      })
      observer.observe(el)
      return () => {
        cancelAnimationFrame(animationFrame)
        observer.unobserve(el)
      }
    }
  }, [])

  // Virtualization reads fresh selection via a ref so the scroll listener does
  // not have to be re-installed every time the selection changes (which would
  // otherwise cause an O(n) display-reset storm on every arrow keypress).
  const selectedItemIdRef = React.useRef(selectedItemId)
  selectedItemIdRef.current = selectedItemId
  const syncRef = React.useRef<((fromSelection?: boolean) => void) | null>(null)

  React.useEffect(() => {
    if (!virtualized) {
      const sizer = context.listInnerRef.current
      if (sizer) {
        sizer.style.paddingTop = ''
        sizer.style.paddingBottom = ''
      }
      context.listInnerRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR).forEach((item) => {
        item.style.display = ''
      })
      syncRef.current = null
      return
    }

    const list = ref.current
    const sizer = context.listInnerRef.current
    if (!list || !sizer) return

    const syncVirtualWindow = (fromSelection = false) => {
      const items = Array.from(sizer.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
      if (items.length === 0) {
        sizer.style.paddingTop = '0px'
        sizer.style.paddingBottom = '0px'
        return
      }

      const estHeight = Math.max(1, itemHeight)
      // Viewport-driven window. The selection can live anywhere; on a pure
      // scroll we must NOT rewrite start/end to wrap the selection, or rows
      // at the user's scroll position get hidden in favor of rows near the
      // (off-screen) selection.
      let start = Math.max(0, Math.floor(list.scrollTop / estHeight) - overscan)
      let end = Math.min(items.length - 1, Math.ceil((list.scrollTop + list.clientHeight) / estHeight) + overscan)

      // The estimated height can be smaller than the rendered row height.
      // Pin the final item when the browser has clamped the list to its real
      // scroll boundary so a small estimate error cannot hide the last rows.
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 1) {
        end = items.length - 1
      }

      if (fromSelection) {
        const sid = selectedItemIdRef.current
        const selectedIndex = sid ? items.findIndex((item) => item.id === sid) : -1
        if (selectedIndex !== -1 && (selectedIndex < start || selectedIndex > end)) {
          list.scrollTop = Math.max(0, selectedIndex * estHeight - list.clientHeight / 2)
          start = Math.max(0, selectedIndex - overscan)
          end = Math.min(items.length - 1, selectedIndex + overscan)
        }
      }

      items.forEach((item, index) => {
        const isVisible = index >= start && index <= end
        item.style.display = isVisible ? '' : 'none'
      })

      sizer.style.paddingTop = `${start * estHeight}px`
      sizer.style.paddingBottom = `${Math.max(items.length - end - 1, 0) * estHeight}px`
    }
    syncRef.current = syncVirtualWindow

    syncVirtualWindow(true)
    const onScroll = () => syncVirtualWindow(false)
    list.addEventListener('scroll', onScroll, { passive: true })

    const mutationObserver = new MutationObserver(() => syncVirtualWindow(false))
    mutationObserver.observe(sizer, { childList: true, subtree: true })

    return () => {
      list.removeEventListener('scroll', onScroll)
      mutationObserver.disconnect()
      syncRef.current = null
    }
  }, [virtualized, itemHeight, overscan])

  // Re-window on selection/search/mode changes without tearing down the
  // listener — avoids the reflow storm from resetting display on every row.
  useIsomorphicLayoutEffect(() => {
    syncRef.current?.(true)
  }, [selectedItemId, search, mode])

  return (
    <Primitive.div
      ref={composeRefs(ref, forwardedRef)}
      {...etc}
      cmdk-list=""
      role="listbox"
      tabIndex={-1}
      aria-activedescendant={selectedItemId}
      aria-multiselectable={context.getSelectionMode() === 'multiple' ? true : undefined}
      aria-label={label}
      id={context.listId}
      data-virtualized={virtualized ? true : undefined}
    >
      {SlottableWithNestedChildren(props, (child) => (
        <div ref={composeRefs(height, context.listInnerRef)} cmdk-list-sizer="">
          {child}
        </div>
      ))}
    </Primitive.div>
  )
})

/**
 * Renders the command menu in a Radix Dialog.
 */
const Dialog = React.forwardRef<HTMLDivElement, DialogProps>((props, forwardedRef) => {
  const { open, onOpenChange, overlayClassName, contentClassName, container, label, description, cspNonce, ...etc } = props
  const title = label ?? props['aria-label'] ?? ''
  const previousNonceRef = React.useRef<string | undefined>()

  if (cspNonce && typeof window !== 'undefined') {
    const win = window as Window & { __webpack_nonce__?: string }
    if (previousNonceRef.current === undefined) {
      previousNonceRef.current = win.__webpack_nonce__
    }
    win.__webpack_nonce__ = cspNonce
  }

  useIsomorphicLayoutEffect(() => {
    if (!cspNonce || typeof window === 'undefined') return
    const win = window as Window & { __webpack_nonce__?: string }
    const nonceMarker = document.createElement('style')
    nonceMarker.setAttribute('nonce', cspNonce)
    nonceMarker.setAttribute('data-cmdk-csp', '')
    nonceMarker.textContent = '/* cmdk csp nonce */'
    document.head.appendChild(nonceMarker)

    const shouldTagStyle = (node: HTMLStyleElement) => {
      const css = node.textContent ?? ''
      return css.includes('data-scroll-locked') || css.includes('block-interactivity-')
    }
    const applyNonce = (node: HTMLStyleElement) => {
      if (node.nonce || !shouldTagStyle(node)) return
      node.setAttribute('nonce', cspNonce)
    }

    document.querySelectorAll('style').forEach((node) => applyNonce(node as HTMLStyleElement))
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLStyleElement) {
            applyNonce(node)
          }
        }
      }
    })
    observer.observe(document.head, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      nonceMarker.remove()
      if (previousNonceRef.current === undefined) delete win.__webpack_nonce__
      else win.__webpack_nonce__ = previousNonceRef.current
    }
  }, [cspNonce])

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal container={container}>
        <RadixDialog.Overlay cmdk-overlay="" className={overlayClassName} nonce={cspNonce} />
        <RadixDialog.Content aria-label={label} cmdk-dialog="" className={contentClassName} nonce={cspNonce}>
          <div style={visuallyHiddenStyle}>
            <RadixDialog.Title>{title}</RadixDialog.Title>
            {description ? <RadixDialog.Description>{description}</RadixDialog.Description> : null}
          </div>
          <Command ref={forwardedRef} label={label} cspNonce={cspNonce} {...etc} />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
})

/**
 * Automatically renders when there are no results for the search query.
 */
const Empty = React.forwardRef<HTMLDivElement, EmptyProps>((props, forwardedRef) => {
  const render = useCmdk((state) => state.filtered.count === 0)

  if (!render) return null
  return <Primitive.div ref={forwardedRef} {...props} cmdk-empty="" role="presentation" />
})

/**
 * You should conditionally render this with `progress` while loading asynchronous items.
 */
const Loading = React.forwardRef<HTMLDivElement, LoadingProps>((props, forwardedRef) => {
  const { progress, children, label = 'Loading...', ...etc } = props
  const context = useCommand()
  const loading = context.getLoading()

  if (loading === false) return null

  return (
    <Primitive.div
      ref={forwardedRef}
      {...etc}
      cmdk-loading=""
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      {SlottableWithNestedChildren(props, (child) => (
        <div aria-hidden>{child}</div>
      ))}
    </Primitive.div>
  )
})

const pkg = Object.assign(Command, {
  List,
  Mode,
  Item,
  Action,
  Input,
  Group,
  Separator,
  Dialog,
  Empty,
  Loading,
})

export { useCmdk as useCommandState }
export { useActionRegistry, useActionRun }
export { pkg as Command }
export { defaultFilter }

export { Command as CommandRoot }
export { List as CommandList }
export { Mode as CommandMode }
export { Item as CommandItem }
export { Action as CommandAction }
export { Input as CommandInput }
export { Group as CommandGroup }
export { Separator as CommandSeparator }
export { Dialog as CommandDialog }
export { Empty as CommandEmpty }
export { Loading as CommandLoading }

export {
  actionExecutorFromAdapter,
  createActionRegistry,
  createOpenApiExecutionAdapter,
  createOpenApiActionSourceAdapter,
  defineActions,
  OpenApiExecutionError,
  requiresActionConfirmation,
} from 'master-cmdk-core'
export type {
  ActionAdapterContext,
  ActionAdapterReference,
  ActionAuthority,
  ActionAuthorityRequirement,
  ActionAuthorizer,
  ActionConfirmation,
  ActionDefinition,
  ActionDocumentSource,
  ActionEffects,
  ActionExecutionAdapter,
  ActionExecutionContext,
  ActionExecutionReference,
  ActionExecutionRequest,
  ActionExecutor,
  ActionManifest,
  ActionPermissionAdapter,
  ActionPermissionDecision,
  ActionPermissionReference,
  ActionPermissionRequest,
  ActionRegistry,
  ActionRegistryOptions,
  ActionRegistrySnapshot,
  ActionRunSnapshot,
  ActionRunStatus,
  ActionSchema,
  ActionSource,
  ActionSourceAdapter,
  ExecuteActionOptions,
  OpenApiActionSourceAdapter,
  OpenApiActionSourceAdapterOptions,
  OpenApiDocument,
  OpenApiAllowedOperation,
  OpenApiExecutionAdapter,
  OpenApiExecutionAdapterOptions,
  OpenApiExecutionErrorCode,
  OpenApiExecutionInput,
  OpenApiExecutionLimits,
  OpenApiExecutionResult,
  OpenApiRuntimeConfig,
  OpenApiRuntimeRequest,
  OpenApiRuntimeResolver,
} from 'master-cmdk-core'

/**
 *
 *
 * Helpers
 *
 *
 */

function findNextSibling(el: Element, selector: string) {
  let sibling = el.nextElementSibling

  while (sibling) {
    if (sibling.matches(selector)) return sibling
    sibling = sibling.nextElementSibling
  }
}

function findPreviousSibling(el: Element, selector: string) {
  let sibling = el.previousElementSibling

  while (sibling) {
    if (sibling.matches(selector)) return sibling
    sibling = sibling.previousElementSibling
  }
}

function findScrollableAncestor(el: Element): HTMLElement | null {
  let node: Element | null = el.parentElement
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node)
    const overflowY = style.overflowY
    const scrollable = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
    if (scrollable && node.scrollHeight > node.clientHeight) {
      return node as HTMLElement
    }
    node = node.parentElement
  }
  return null
}

function useAsRef<T>(data: T) {
  const ref = React.useRef<T>(data)

  ref.current = data

  return ref
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

function useLazyRef<T>(fn: () => T) {
  const ref = React.useRef<T>()

  if (ref.current === undefined) {
    ref.current = fn()
  }

  return ref as React.MutableRefObject<T>
}

/** Run a selector against the store state. */
function useCmdk<T = any>(selector: (state: State) => T): T {
  const store = useStore()
  const cb = () => selector(store.snapshot())
  return React.useSyncExternalStore(store.subscribe, cb, cb)
}

function useActionRegistry(registry: ActionRegistry): ActionRegistrySnapshot {
  return React.useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
}

function useActionRun<TInput = unknown, TOutput = unknown>(
  registry: ActionRegistry,
  actionId: string,
): ActionRunSnapshot<TInput, TOutput> {
  const snapshot = useActionRegistry(registry)
  const idle = React.useMemo<ActionRunSnapshot<TInput, TOutput>>(
    () => ({ actionId, status: 'idle' }),
    [actionId],
  )
  return (snapshot.runs.get(actionId) as ActionRunSnapshot<TInput, TOutput> | undefined) ?? idle
}

function useValueSelected(value: React.MutableRefObject<string | undefined>) {
  const store = useStore()
  const [selected, setSelected] = React.useState(() => {
    return Boolean(store.snapshot().value && store.snapshot().value === value.current)
  })

  useIsomorphicLayoutEffect(() => {
    const isSelected = () => Boolean(store.snapshot().value && store.snapshot().value === value.current)
    setSelected(isSelected())
    return store.subscribeValue(value.current, () => {
      setSelected(isSelected())
    })
  }, [store, value.current])

  return selected
}

function useValuePointerOver(value: React.MutableRefObject<string | undefined>) {
  const store = useStore()
  const [over, setOver] = React.useState(() => {
    return Boolean(store.snapshot().pointerValue && store.snapshot().pointerValue === value.current)
  })

  useIsomorphicLayoutEffect(() => {
    const isOver = () => Boolean(store.snapshot().pointerValue && store.snapshot().pointerValue === value.current)
    setOver(isOver())
    return store.subscribePointerValue(value.current, () => {
      setOver(isOver())
    })
  }, [store, value.current])

  return over
}

function useValueChecked(value: React.MutableRefObject<string | undefined>) {
  const store = useStore()
  const context = useCommand()
  const [checked, setChecked] = React.useState(() => {
    return value.current !== undefined && store.snapshot().selectedValues.has(value.current)
  })

  useIsomorphicLayoutEffect(() => {
    if (context.getSelectionMode() !== 'multiple') {
      setChecked(false)
      return
    }

    const isChecked = () => value.current !== undefined && store.snapshot().selectedValues.has(value.current)
    setChecked(isChecked())
    return store.subscribeCheckedValue(value.current, () => {
      setChecked(isChecked())
    })
  }, [store, value.current, context])

  return checked
}

function toTrimmedValueSet(values: string[]): Set<string> {
  const next = new Set<string>()
  values.forEach((entry) => {
    next.add(String(entry).trim())
  })
  return next
}

function areSetsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}

function useValue(
  id: string,
  ref: React.RefObject<HTMLElement>,
  deps: (string | React.ReactNode | React.RefObject<HTMLElement>)[],
  aliases: string[] = [],
) {
  const valueRef = React.useRef<string>()
  const context = useCommand()

  useIsomorphicLayoutEffect(() => {
    const value = (() => {
      for (const part of deps) {
        if (typeof part === 'string') {
          return part.trim()
        }

        if (typeof part === 'object' && 'current' in part) {
          if (part.current) {
            return part.current.textContent?.trim()
          }
          return valueRef.current
        }
      }
    })()

    const keywords = aliases.map((alias) => alias.trim())

    context.value(id, value, keywords)
    ref.current?.setAttribute(VALUE_ATTR, value)
    valueRef.current = value
  })

  return valueRef
}

/** Imperatively run a function on the next layout effect cycle. */
const useScheduleLayoutEffect = () => {
  const [s, ss] = React.useState<object>()
  const fns = useLazyRef(() => new Map<string | number, () => void>())

  useIsomorphicLayoutEffect(() => {
    fns.current.forEach((f) => f())
    fns.current = new Map()
  }, [s])

  return (id: string | number, cb: () => void) => {
    fns.current.set(id, cb)
    ss({})
  }
}

function renderChildren(children: React.ReactElement) {
  const childrenType = children.type as any
  // The children is a component
  if (typeof childrenType === 'function') return childrenType(children.props)
  // The children is a component with `forwardRef`
  else if ('render' in childrenType) return childrenType.render(children.props)
  // It's a string, boolean, etc.
  else return children
}

function SlottableWithNestedChildren(
  { asChild, children }: { asChild?: boolean; children?: React.ReactNode },
  render: (child: React.ReactNode) => JSX.Element,
) {
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(renderChildren(children), { ref: (children as any).ref }, render(children.props.children))
  }
  return render(children)
}
