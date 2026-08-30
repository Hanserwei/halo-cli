import { describe, expect, it } from 'vitest'

import {
  buildMenu,
  buildMenuItem,
  buildUpdatedMenuItem,
  collectMenuItemNames,
  findMenuItemNode,
  normalizeMenuItemTarget,
  normalizeMenuRefKind,
} from '../src/commands/menu.js'
import type { MenuItem, MenuItemTreeNode } from '../src/types.js'

function item(name: string, parent?: string): MenuItem {
  return {
    apiVersion: 'v1alpha1',
    kind: 'MenuItem',
    metadata: { name },
    spec: {
      displayName: name,
      href: `/${name}`,
      menuName: 'primary',
      parent,
      priority: 0,
      target: '_self',
    },
  }
}

const tree: MenuItemTreeNode[] = [
  {
    children: [
      { children: [], menuItem: item('child-one', 'root') },
      {
        children: [{ children: [], menuItem: item('grandchild', 'child-two') }],
        menuItem: item('child-two', 'root'),
      },
    ],
    menuItem: item('root'),
  },
]

describe('menu resources', () => {
  it('builds menus without writing the deprecated hierarchy fields', () => {
    expect(buildMenu(' Main navigation ')).toEqual({
      apiVersion: 'v1alpha1',
      kind: 'Menu',
      metadata: { generateName: 'menu-', name: '' },
      spec: { displayName: 'Main navigation' },
    })
  })

  it('normalizes targets and supported reference kinds', () => {
    expect(normalizeMenuItemTarget(' blank ')).toBe('_blank')
    expect(normalizeMenuItemTarget('_TOP')).toBe('_top')
    expect(normalizeMenuRefKind('page')).toBe('SinglePage')
    expect(normalizeMenuRefKind('single-page')).toBe('SinglePage')
    expect(() => normalizeMenuItemTarget('window')).toThrow('target')
    expect(() => normalizeMenuRefKind('User')).toThrow('引用类型')
  })

  it('builds custom and referenced menu items using the 2.26 hierarchy model', () => {
    expect(
      buildMenuItem('primary', 'root', 2, {
        displayName: ' Docs ',
        href: ' /docs ',
        target: 'blank',
      }).spec,
    ).toEqual({
      displayName: 'Docs',
      href: '/docs',
      menuName: 'primary',
      parent: 'root',
      priority: 2,
      target: '_blank',
    })

    expect(
      buildMenuItem('primary', undefined, 0, {
        refKind: 'post',
        refName: 'post-one',
      }).spec,
    ).toEqual({
      menuName: 'primary',
      parent: undefined,
      priority: 0,
      target: '_self',
      targetRef: {
        group: 'content.halo.run',
        kind: 'Post',
        name: 'post-one',
        version: 'v1alpha1',
      },
    })
  })

  it('updates menu item source without mixing custom fields and target refs', () => {
    const custom = item('custom')
    const referenced = buildUpdatedMenuItem(custom, {
      refKind: 'category',
      refName: 'category-one',
      target: '_top',
    })
    expect(referenced.spec.displayName).toBeUndefined()
    expect(referenced.spec.href).toBeUndefined()
    expect(referenced.spec.targetRef).toMatchObject({ kind: 'Category', name: 'category-one' })
    expect(referenced.spec.target).toBe('_top')

    const restored = buildUpdatedMenuItem(referenced, {
      displayName: 'Category landing',
      href: '/categories',
      refKind: 'custom',
    })
    expect(restored.spec.targetRef).toBeUndefined()
    expect(restored.spec.displayName).toBe('Category landing')
    expect(restored.spec.href).toBe('/categories')
  })

  it('rejects ambiguous source options', () => {
    expect(() =>
      buildMenuItem('primary', undefined, 0, {
        displayName: 'Post',
        href: '/post',
        refKind: 'post',
        refName: 'post-one',
      }),
    ).toThrow('不能同时')
    expect(() => buildMenuItem('primary', undefined, 0, { refName: 'post-one' })).toThrow(
      '--ref-kind',
    )
  })

  it('finds and flattens complete menu item subtrees', () => {
    const found = findMenuItemNode(tree, 'child-two')
    expect(found).toBeDefined()
    expect(collectMenuItemNames(found!)).toEqual(['child-two', 'grandchild'])
    expect(findMenuItemNode(tree, 'missing')).toBeUndefined()
  })
})
