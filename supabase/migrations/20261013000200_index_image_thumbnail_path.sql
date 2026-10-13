-- thumbnail_path 的访问校验索引（并发建索引，不阻塞写入）。
--
-- 与 20261013000100_index_image_preview_path.sql 同属一组：那条补 preview_path，
-- 这条补 thumbnail_path，合起来让访问校验那条三列 OR 的每一支都有索引可用。
--
-- 为什么要单独一个文件：Supabase CLI 按文件分批执行，同一文件里的第二个
-- CREATE INDEX CONCURRENTLY 会失败（SQLSTATE 25001，本机用 supabase 2.105.0
-- 实测确认）。官方维护者在 supabase/cli#2898 里给的结论也是
-- 「the only guaranteed way to create an index concurrently is to execute it in
-- its own migration file」。所以这两个索引必须各占一个迁移文件。

create index concurrently if not exists image_generations_thumbnail_path_idx
  on public.image_generations (thumbnail_path);

comment on index public.image_generations_thumbnail_path_idx is
  'Supports the storage_path/preview_path/thumbnail_path OR lookup used by image access checks.';
