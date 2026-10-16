export interface AccessKey {
  name: string
  displayName: string
  keyPrefix: string
  ownerName: string
  scopes: string[]
  enabled: boolean
  allowedIpRanges: string[]
  expiresAt?: string | null
  createdAt?: string | null
  lastUsedAt?: string | null
}

export interface Scope {
  name: string
  displayName: string
  description: string
}

export interface CreateAccessKeyRequest {
  displayName: string
  scopes: string[]
  allowedIpRanges?: string[]
  expiresAt?: string | null
}

export interface UpdateAccessKeyRequest extends CreateAccessKeyRequest {
  enabled: boolean
}

export interface AccessKeySecret {
  key: AccessKey
  token: string
}

export interface AccessKeyApi {
  listKeys(): Promise<AccessKey[]>
  listScopes(): Promise<Scope[]>
  createKey(request: CreateAccessKeyRequest): Promise<AccessKeySecret>
  updateKey(name: string, request: UpdateAccessKeyRequest): Promise<AccessKey>
  rotateKey(name: string): Promise<AccessKeySecret>
  deleteKey(name: string): Promise<void>
}
