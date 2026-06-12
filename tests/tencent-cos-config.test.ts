import { describe, expect, it } from 'vitest'
import { resolveTencentCosBucket } from '../backend/gateway/src/config'

describe('Tencent COS config', () => {
  it('combines the bucket base name and app id', () => {
    expect(resolveTencentCosBucket('recho-images', '1363083511')).toBe('recho-images-1363083511')
  })

  it('keeps already-complete bucket names compatible', () => {
    expect(resolveTencentCosBucket('recho-images-1363083511', '1363083511')).toBe('recho-images-1363083511')
  })

  it('allows legacy full-bucket configuration without app id', () => {
    expect(resolveTencentCosBucket('recho-images-1363083511', '')).toBe('recho-images-1363083511')
  })

  it('returns an empty string when the bucket base name is empty', () => {
    expect(resolveTencentCosBucket('', '1363083511')).toBe('')
  })

  it('trims bucket and app id inputs before combining', () => {
    expect(resolveTencentCosBucket('  recho-images  ', '  1363083511  ')).toBe('recho-images-1363083511')
  })
})
