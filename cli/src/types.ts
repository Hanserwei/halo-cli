export interface Metadata {
  annotations?: Record<string, string>
  creationTimestamp?: string | null
  generateName?: string
  labels?: Record<string, string>
  name: string
  version?: number | null
}

export interface Excerpt {
  autoGenerate: boolean
  raw?: string
}

export interface Post {
  apiVersion: 'content.halo.run/v1alpha1'
  kind: 'Post'
  metadata: Metadata
  spec: {
    allowComment: boolean
    categories?: string[]
    cover?: string
    deleted: boolean
    excerpt: Excerpt
    pinned: boolean
    priority: number
    publish: boolean
    publishTime?: string
    slug: string
    tags?: string[]
    template?: string
    title: string
    visible: 'PUBLIC' | 'INTERNAL' | 'PRIVATE'
  }
  status?: {
    excerpt?: string
    lastModifyTime?: string
    permalink?: string
    phase?: string
  }
}

export interface Content {
  content: string
  raw: string
  rawType: string
}

export interface ContentWrapper extends Partial<Content> {
  snapshotName?: string
}

export interface PostRequest {
  content: Content
  post: Post
}

export interface Category {
  apiVersion: 'content.halo.run/v1alpha1'
  kind: 'Category'
  metadata: Metadata
  spec: {
    cover?: string
    description?: string
    displayName: string
    hideFromList?: boolean
    parent?: string
    priority: number
    slug: string
  }
  status?: {
    permalink?: string
    postCount?: number
    visiblePostCount?: number
  }
}

export interface Tag {
  apiVersion: 'content.halo.run/v1alpha1'
  kind: 'Tag'
  metadata: Metadata
  spec: {
    color?: string
    cover?: string
    description?: string
    displayName: string
    slug: string
  }
  status?: {
    permalink?: string
    postCount?: number
    visiblePostCount?: number
  }
}

export interface Page<T> {
  first: boolean
  hasNext: boolean
  hasPrevious: boolean
  items: T[]
  last: boolean
  page: number
  size: number
  total: number
  totalPages: number
}

export interface ListedPost {
  post: Post
}

export interface Profile {
  token: string
  url: string
}

export interface CliConfig {
  currentProfile?: string
  profiles: Record<string, Profile>
}

export interface ConnectionOptions {
  profile?: string
  token?: string
  url?: string
}

export interface OutputOptions {
  json?: boolean
}
