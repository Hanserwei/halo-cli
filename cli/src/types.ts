export interface Metadata {
  annotations?: Record<string, string>
  creationTimestamp?: string | null
  deletionTimestamp?: string | null
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

export type Visibility = 'PUBLIC' | 'INTERNAL' | 'PRIVATE'

export interface SinglePage {
  apiVersion: 'content.halo.run/v1alpha1'
  kind: 'SinglePage'
  metadata: Metadata
  spec: {
      allowComment: boolean
      baseSnapshot?: string
      cover?: string
      deleted: boolean
      excerpt: Excerpt
      headSnapshot?: string
      owner?: string
      pinned: boolean
    priority: number
      publish: boolean
      publishTime?: string
      releaseSnapshot?: string
      slug: string
    template?: string
    title: string
    visible: Visibility
  }
  status?: {
    excerpt?: string
    lastModifyTime?: string
    permalink?: string
    phase?: string
  }
}

export interface SinglePageRequest {
  content: Content
  page: SinglePage
}

export interface ListedSinglePage {
  page: SinglePage
}

export interface ListedSnapshot {
  metadata: Metadata
  spec: {
    modifyTime?: string
    owner: string
  }
}

export interface SubjectRef {
  group: string
  kind: string
  name: string
  version: string
}

export interface CommentOwner {
  displayName?: string
  kind?: string
  name?: string
  [key: string]: unknown
}

export interface Comment {
  apiVersion: 'content.halo.run/v1alpha1'
  kind: 'Comment'
  metadata: Metadata
  spec: {
    allowNotification: boolean
    approved: boolean
    approvedTime?: string
    content: string
    creationTime?: string
    hidden: boolean
    owner: CommentOwner
    priority: number
    raw: string
    subjectRef: SubjectRef
    top: boolean
  }
  status?: Record<string, unknown>
}

export interface Reply {
  apiVersion: 'content.halo.run/v1alpha1'
  kind: 'Reply'
  metadata: Metadata
  spec: {
    allowNotification: boolean
    approved: boolean
    approvedTime?: string
    commentName: string
    content: string
    creationTime?: string
    hidden: boolean
    owner: CommentOwner
    priority: number
    quoteReply?: string
    raw: string
    top: boolean
  }
  status?: Record<string, unknown>
}

export interface ListedComment {
  comment: Comment
  owner?: Record<string, unknown>
  stats?: Record<string, unknown>
  subject?: Record<string, unknown>
}

export interface ListedReply {
  owner?: Record<string, unknown>
  reply: Reply
  stats?: Record<string, unknown>
}

export interface ReplyRequest {
  allowNotification?: boolean
  content: string
  hidden?: boolean
  quoteReply?: string
  raw: string
}

export interface JsonPatch {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

export interface Attachment {
  apiVersion: 'storage.halo.run/v1alpha1'
  kind: 'Attachment'
  metadata: Metadata
  spec: {
    displayName?: string
    groupName?: string
    mediaType?: string
    ownerName?: string
    policyName?: string
    size?: number
    tags?: string[]
  }
  status?: {
    permalink?: string
    thumbnails?: Record<string, string>
  }
}

export interface StoragePolicy {
  apiVersion: 'storage.halo.run/v1alpha1'
  kind: 'Policy'
  metadata: Metadata
  spec: {
    displayName: string
    templateName?: string
    [key: string]: unknown
  }
}

export interface AttachmentGroup {
  apiVersion: 'storage.halo.run/v1alpha1'
  kind: 'Group'
  metadata: Metadata
  spec: {
    displayName: string
  }
  status?: Record<string, unknown>
}

export interface ExtensionRef {
  group: string
  kind: string
  name: string
  version?: string
}

export interface Menu {
  apiVersion: 'v1alpha1'
  kind: 'Menu'
  metadata: Metadata
  spec: {
    displayName: string
    menuItems?: string[]
  }
}

export type MenuItemTarget = '_blank' | '_parent' | '_self' | '_top'

export interface MenuItem {
  apiVersion: 'v1alpha1'
  kind: 'MenuItem'
  metadata: Metadata
  spec: {
    children?: string[]
    displayName?: string
    href?: string
    menuName?: string
    parent?: string
    priority?: number
    target?: MenuItemTarget
    targetRef?: ExtensionRef
  }
  status?: {
    displayName?: string
    href?: string
  }
}

export interface MenuItemTreeNode {
  children: MenuItemTreeNode[]
  menuItem: MenuItem
}

export interface MenuItemPositionRequest {
  beforeName?: string
  menuName: string
  parentName?: string
}

export interface MenuSystemConfig {
  primary?: string
}

export interface Plugin {
  apiVersion: string
  kind: string
  metadata: Metadata
  spec: {
    configMapName?: string
    description?: string
    displayName?: string
    enabled?: boolean
    logo?: string
    requires?: string
    repo?: string
    settingName?: string
    version: string
    [key: string]: unknown
  }
  status?: Record<string, unknown>
}

export interface Theme {
  apiVersion: string
  kind: string
  metadata: Metadata
  spec: {
    configMapName?: string
    description?: string
    displayName: string
    logo?: string
    requires?: string
    repo?: string
    settingName?: string
    customTemplates?: Record<
      string,
      Array<{
        description?: string
        file: string
        name: string
        screenshot?: string
      }>
    >
    version?: string
    [key: string]: unknown
  }
  status?: Record<string, unknown>
}

export interface Setting {
  apiVersion: string
  kind: string
  metadata: Metadata
  spec: {
    forms: unknown[]
    [key: string]: unknown
  }
}

export type JsonObject = Record<string, unknown>

export interface HaloExtension {
  apiVersion: string
  kind: string
  metadata: Metadata
  spec?: Record<string, unknown>
  status?: Record<string, unknown>
  [key: string]: unknown
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
