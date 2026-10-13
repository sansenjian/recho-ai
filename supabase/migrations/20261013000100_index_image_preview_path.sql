-- preview_path 的访问校验索引（并发建索引，不阻塞写入）。
--
-- 背景：ProxyStorage 与 PresignStorage 都要按 storage_path / preview_path /
-- thumbnail_path 三列之一反查 image_generations，判断图片是公有还是私有。
-- 查询写成三列 OR：
--
--   WHERE storage_path = $1 OR preview_path = $1 OR thumbnail_path = $1
--
-- 这种写法用不上单列索引——优化器无法把 OR 拆成几次索引扫描，只能全表顺序
-- 扫描。而 storage_path 的索引（image_generations_storage_path_idx，见
-- 20260626000000_restore_admin_rpcs.sql）是给管理端 storage overview RPC 用的
-- 单列索引，对这条 OR 查询同样无效，preview_path / thumbnail_path 则连索引
-- 都没有。补上后 OR 的每一支都有索引可用，优化器可以改成 BitmapOr 走三次索引
-- 扫描，不必再读全表。
--
-- 用 CONCURRENTLY：普通 CREATE INDEX 在构建期间持有写锁，会阻塞图片历史写入。
--
-- 注意这条迁移必须只含一个 CREATE INDEX CONCURRENTLY。Supabase CLI 按文件分批
-- 执行，同一个文件里的第二个 CONCURRENTLY 会以
-- 「CREATE INDEX CONCURRENTLY cannot be executed within a pipeline (SQLSTATE 25001)」
-- 失败——本机用 supabase 2.105.0 实测确认过。thumbnail_path 的索引因此单独放在
-- 后一个迁移文件里。

create index concurrently if not exists image_generations_preview_path_idx
  on public.image_generations (preview_path);

comment on index public.image_generations_preview_path_idx is
  'Supports the storage_path/preview_path/thumbnail_path OR lookup used by image access checks.';
