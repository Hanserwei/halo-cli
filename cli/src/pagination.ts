import type { Page } from './types.js'

export function filterAndPaginate<T>(
  items: T[],
  predicate: (item: T) => boolean,
  page: number,
  size: number,
): Page<T> {
  const filtered = items.filter(predicate)
  const totalPages = Math.ceil(filtered.length / size)
  const offset = (page - 1) * size
  return {
    first: page === 1,
    hasNext: page < totalPages,
    hasPrevious: page > 1 && totalPages > 0,
    items: filtered.slice(offset, offset + size),
    last: totalPages === 0 || page >= totalPages,
    page,
    size,
    total: filtered.length,
    totalPages,
  }
}
