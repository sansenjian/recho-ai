import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(process.cwd(), 'supabase/migrations')
const previewPath = resolve(migrationsDir, '20261013000100_index_image_preview_path.sql')
const thumbnailPath = resolve(migrationsDir, '20261013000200_index_image_thumbnail_path.sql')

const previewSql = readFileSync(previewPath, 'utf8').toLowerCase()
const thumbnailSql = readFileSync(thumbnailPath, 'utf8').toLowerCase()

/**
 * 去掉 SQL 行注释后再数语句。
 *
 * 这两个迁移的注释里就写着 "create index concurrently" 这句话（在解释为什么
 * 必须一个文件一个），不剥离的话数的全是注释，测试会对着说明文字报错，而真正
 * 要盯的语句反而没被看住。
 */
function stripLineComments(sql: string) {
  return sql.replace(/--[^\n]*/g, '')
}

function countConcurrently(sql: string) {
  return stripLineComments(sql).match(/create index concurrently/g)?.length ?? 0
}

/**
 * 图片路径反查的索引。
 *
 * 访问校验按三列 OR 反查 image_generations，单列索引对这条查询无效——OR 的每
 * 一支都必须有索引，优化器才能拆成 BitmapOr 而不是全表扫描。storage_path 已
 * 有索引（历史迁移里建的），这里盯的是补上的两列别再被删掉。
 *
 * 同时盯住「一个文件只能有一个 CONCURRENTLY」：CLI 按文件分批执行，同文件里
 * 第二个会以 SQLSTATE 25001 失败。本机用 supabase 2.105.0 实测：文件内放两个
 * CONCURRENTLY 时，第二个报
 * 「CREATE INDEX CONCURRENTLY cannot be executed within a pipeline」。
 */
describe('image path lookup index migrations', () => {
  it('indexes the two path columns that had no index', () => {
    expect(previewSql).toMatch(
      /create index concurrently if not exists image_generations_preview_path_idx\s+on public\.image_generations \(preview_path\)/,
    )
    expect(thumbnailSql).toMatch(
      /create index concurrently if not exists image_generations_thumbnail_path_idx\s+on public\.image_generations \(thumbnail_path\)/,
    )
  })

  it('covers every column of the access-check OR', () => {
    // storage_path 的索引来自 20260626000000_restore_admin_rpcs.sql；这两条迁移
    // 只补另外两列。三列齐了，OR 的每一支才都有索引可用。
    const restoreMigration = readFileSync(
      resolve(migrationsDir, '20260626000000_restore_admin_rpcs.sql'),
      'utf8',
    ).toLowerCase()
    expect(restoreMigration).toMatch(/on public\.image_generations \(storage_path\)/)

    for (const column of ['storage_path', 'preview_path', 'thumbnail_path']) {
      const indexed =
        previewSql.includes(`(${column})`) ||
        thumbnailSql.includes(`(${column})`) ||
        restoreMigration.includes(`(${column})`)
      expect(indexed, `${column} should have an index`).toBe(true)
    }
  })

  it('keeps one CONCURRENTLY per migration file', () => {
    // 这是硬约束，不是风格问题：同文件里的第二个 CONCURRENTLY 会让整条迁移失败。
    for (const file of [previewPath, thumbnailPath]) {
      const count = countConcurrently(readFileSync(file, 'utf8').toLowerCase())
      expect(count, `${file} must hold exactly one CONCURRENTLY`).toBe(1)
    }
  })

  it('never puts two CONCURRENTLY builds in any migration file', () => {
    // 同一条约束扩到整个仓库：将来新增迁移时别把两个并发建索引塞进一个文件。
    const offenders: string[] = []
    for (const name of readdirSync(migrationsDir)) {
      if (!name.endsWith('.sql')) continue
      const count = countConcurrently(readFileSync(resolve(migrationsDir, name), 'utf8').toLowerCase())
      if (count > 1) offenders.push(`${name} (${count})`)
    }
    expect(offenders).toEqual([])
  })

  it('stays re-runnable', () => {
    // 并发建索引失败会留下 invalid 索引，重跑必须安全，所以一定要带 if not exists。
    for (const sql of [previewSql, thumbnailSql]) {
      const statements = sql.match(/create index[^;]*;/g) ?? []
      expect(statements.length).toBeGreaterThan(0)
      for (const statement of statements) {
        expect(statement).toContain('if not exists')
      }
    }
  })
})
