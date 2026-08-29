import { describe, expect, it } from 'vitest'

import { filterAndPaginate } from '../src/pagination.js'

describe('client-side keyword pagination', () => {
  it('filters before paginating without requiring a Halo field index', () => {
    const result = filterAndPaginate(
      ['Halo', 'Other', 'halo CLI', 'HALO Theme'],
      (value) => value.toLowerCase().includes('halo'),
      2,
      2,
    )

    expect(result).toMatchObject({
      first: false,
      hasNext: false,
      hasPrevious: true,
      items: ['HALO Theme'],
      last: true,
      page: 2,
      size: 2,
      total: 3,
      totalPages: 2,
    })
  })
})
