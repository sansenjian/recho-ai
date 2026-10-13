import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20261013000100_index_image_path_lookups.sql',
)
const sql = readFileSync(migrationPath, 'utf8').toLowerCase()

/**
 * 图片路径反查的索引。
 *
 * 访问校验按三列 OR 反查 image_generations，单列索引对这条查询无效——OR 的每
 * 一支都必须有索引，优化器才能拆成 BitmapOr 而不是全表扫描。storage_path 已
 * 有索引（历史迁移里建的），这里盯的是补上的两列别再被删掉。
 */
describe('image path lookup index migration', () => {
  it('indexes the two path columns that had no index', () => {
    expect(sql).toMatch(
      /create index if not exists image_generations_preview_path_idx\s+on public\.image_generations \(preview_path\)/,
    )
    expect(sql).toMatch(
      /create index if not exists image_generations_thumbnail_path_idx\s+on public\.image_generations \(thumbnail_path\)/,
    )
  })

  it('covers every column of the access-check OR', () => {
    // storage_path 的索引来自 20260626000000_restore_admin_rpcs.sql；这条迁移
    // 只补另外两列。三列齐了，OR 的每一支才都有索引可用。
    const restoreMigration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20260626000000_restore_admin_rpcs.sql'),
      'utf8',
    ).toLowerCase()
    expect(restoreMigration).toContain('image_generations_storage_path_idx')
    expect(restoreMigration).toMatch(/on public\.image_generations \(storage_path\)/)

    for (const column of ['storage_path', 'preview_path', 'thumbnail_path']) {
      const indexed = sql.includes(`(${column})`) || restoreMigration.includes(`(${column})`)
      expect(indexed, `${column} should have an index`).toBe(true)
    }
  })

  it('stays re-runnable', () => {
    // 这条迁移只加索引，重复执行必须安全：迁移可能在同步过的库上重放。
    const statements = sql.match(/create index[^;]*;/g) ?? []
    expect(statements.length).toBeGreaterThan(0)
    for (const statement of statements) {
      expect(statement).toContain('if not exists')
    }
  })
})
